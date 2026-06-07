# Shell Collector

A multiplayer reverse shell collector with a web UI. Users can start TCP listeners, accept reverse shell connections, and send commands.

## Docker Setup
```bash
# Edit .env with your values
cp .env.example .env

docker build -t shell-collector .

docker run -d \
  --network=host \
  --env-file .env \
  -v shell_data:/app/data \
  -e DATABASE_PATH=/app/data/shell_collector.db \
  shell-collector
```

## Debug setup
```bash
# Edit .env with your values
cp .env.example .env

pip install -r requirements.txt

python debug_server.py # http://localhost:5000
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `dev-secret-key-...` | Flask session secret |
| `ADMIN_USERNAME` | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | `admin` | Initial admin password |
| `GUNICORN_WORKERS` | `1` | Gunicorn worker count |
| `GUNICORN_THREADS` | `4` | Threads per worker |
| `DATABASE_PATH` | `shell_collector.db` | SQLite database file path |
