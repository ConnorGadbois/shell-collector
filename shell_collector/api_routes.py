from flask import Blueprint, request, jsonify, g, current_app

from .database import Listener, ShellClient, Command, Setting
from .auth_routes import login_required, admin_required

api_routes = Blueprint('api_routes', __name__)

@api_routes.route('/api/listeners', methods=['GET'])
@login_required
def list_listeners():
    listeners = Listener.select().order_by(Listener.created_at.desc())
    return jsonify({
        'listeners': [{
            'id': lst.id,
            'address': lst.address,
            'port': lst.port,
            'is_active': lst.is_active,
            'created_at': lst.created_at.isoformat(),
            'shell_count': ShellClient.select().where(
                ShellClient.listener == lst,
                ShellClient.is_active == True
            ).count(),
        } for lst in listeners]
    })

@api_routes.route('/api/listeners', methods=['POST'])
@login_required
def create_listener():
    data = request.get_json()
    address = data.get('address', '0.0.0.0')
    port = data.get('port')

    if not port:
        return jsonify({'error': 'port is required'}), 400
    try:
        port = int(port)
    except (ValueError, TypeError):
        return jsonify({'error': 'invalid port'}), 400
    if port < 1 or port > 65535:
        return jsonify({'error': 'port must be between 1 and 65535'}), 400

    existing = Listener.select().where(
        Listener.port == port,
        Listener.is_active == True
    ).first()
    if existing:
        return jsonify({'error': 'already listening on this port'}), 400

    lst = Listener.create(
        user=g.user,
        address=address,
        port=port,
        is_active=False
    )

    try:
        current_app.manager.start_listener(lst.id, address, port)
        lst.is_active = True
        lst.save()
        return jsonify({
            'listener': {
                'id': lst.id,
                'address': lst.address,
                'port': lst.port,
                'is_active': lst.is_active,
            }
        }), 201
    except Exception as e:
        lst.is_active = False
        lst.save()
        return jsonify({'error': str(e)}), 500

@api_routes.route('/api/listeners/<int:listener_id>', methods=['DELETE'])
@login_required
def stop_listener(listener_id):
    lst = Listener.get_or_none(Listener.id == listener_id)
    if not lst:
        return jsonify({'error': 'listener not found'}), 404

    current_app.manager.stop_listener(lst.id)
    lst.is_active = False
    lst.save()
    return jsonify({'message': 'listener stopped'})

@api_routes.route('/api/listeners/<int:listener_id>/remove', methods=['DELETE'])
@login_required
def delete_listener(listener_id):
    lst = Listener.get_or_none(Listener.id == listener_id)
    if not lst:
        return jsonify({'error': 'listener not found'}), 404

    current_app.manager.stop_listener(lst.id)
    lst.delete_instance(recursive=True)
    return jsonify({'message': 'listener deleted'})

@api_routes.route('/api/listeners/<int:listener_id>/shells', methods=['GET'])
@login_required
def list_shells(listener_id):
    lst = Listener.get_or_none(Listener.id == listener_id)
    if not lst:
        return jsonify({'error': 'listener not found'}), 404

    shells = ShellClient.select().where(
        ShellClient.listener == lst
    ).order_by(ShellClient.connected_at.desc())
    return jsonify({
        'shells': [{
            'id': s.id,
            'ip_address': s.ip_address,
            'hostname': s.hostname,
            'platform': s.platform,
            'connected_at': s.connected_at.isoformat(),
            'last_seen': s.last_seen.isoformat(),
            'is_active': s.is_active,
        } for s in shells]
    })

@api_routes.route('/api/shells/<int:shell_id>/command', methods=['POST'])
@login_required
def send_command(shell_id):
    sc = ShellClient.get_or_none(ShellClient.id == shell_id)
    if not sc:
        return jsonify({'error': 'shell not found'}), 404
    if not sc.is_active:
        return jsonify({'error': 'shell is disconnected'}), 410

    data = request.get_json()
    command = data.get('command', '').strip()
    if not command:
        return jsonify({'error': 'command is required'}), 400

    success = current_app.manager.send_command(shell_id, command)
    if not success:
        return jsonify({'error': 'shell is disconnected'}), 410

    cmd = Command.create(
        shell=sc,
        user=g.user,
        command_text=command,
    )
    return jsonify({'command': {'id': cmd.id, 'command_text': cmd.command_text}}), 201

@api_routes.route('/api/shells/<int:shell_id>/output', methods=['GET'])
@login_required
def get_output(shell_id):
    sc = ShellClient.get_or_none(ShellClient.id == shell_id)
    if not sc:
        return jsonify({'error': 'shell not found'}), 404

    since = request.args.get('since', 0, type=int)
    output, length = current_app.manager.get_output(shell_id, since)
    if output is None:
        return jsonify({'error': 'shell not found'}), 404

    text = output.decode('utf-8', errors='replace')
    return jsonify({'output': text, 'position': length})

@api_routes.route('/api/shells/<int:shell_id>', methods=['DELETE'])
@login_required
def disconnect_shell(shell_id):
    sc = ShellClient.get_or_none(ShellClient.id == shell_id)
    if not sc:
        return jsonify({'error': 'shell not found'}), 404

    current_app.manager.disconnect_shell(shell_id)
    return jsonify({'message': 'shell disconnected'})

@api_routes.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    settings = {s.key: s.value for s in Setting.select()}
    return jsonify({'settings': settings})

@api_routes.route('/api/settings', methods=['PUT'])
@admin_required
def update_settings():
    data = request.get_json()
    for key, value in data.items():
        setting, created = Setting.get_or_create(key=key, defaults={'value': ''})
        setting.value = value
        setting.save()
    settings = {s.key: s.value for s in Setting.select()}
    return jsonify({'settings': settings})
