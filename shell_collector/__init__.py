import os

from flask import Flask, render_template
from werkzeug.security import generate_password_hash


def create_app():
    app = Flask(__name__)
    app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

    # Database init
    from .database import initialize_database, User
    initialize_database()

    # Create the initial admin user if it's not already there
    admin_username = os.environ.get('ADMIN_USERNAME', 'admin')
    admin_password = os.environ.get('ADMIN_PASSWORD', 'admin')
    if not User.select().where(User.username == admin_username).exists():
        User.create(
            username=admin_username,
            password_hash=generate_password_hash(admin_password),
            is_admin=True,
        )
        print(f'Created admin user: {admin_username}/{admin_password}')

    from .manager import ShellManager
    app.manager = ShellManager()

    from .database import Listener as ListenerModel
    for lst in ListenerModel.select().where(ListenerModel.is_active == True):
        try:
            app.manager.start_listener(lst.id, lst.address, lst.port)
        except Exception as e:
            print(f'Failed to restore listener {lst.id}: {e}')
            lst.is_active = False
            lst.save()

    from .auth_routes import auth_routes
    from .api_routes import api_routes
    from .dashboard_routes import dashboard_routes

    app.register_blueprint(auth_routes)
    app.register_blueprint(api_routes)
    app.register_blueprint(dashboard_routes)

    @app.errorhandler(404)
    def not_found(e):
        return render_template('404.html'), 404

    @app.errorhandler(500)
    def server_error(e):
        return render_template('500.html'), 500

    return app
