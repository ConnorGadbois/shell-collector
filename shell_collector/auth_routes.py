from functools import wraps

from flask import Blueprint, request, jsonify, session, g, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

from .database import User

auth_routes = Blueprint('auth_routes', __name__)


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'unauthorized'}), 401
            return redirect(url_for('dashboard_routes.login'))
        try:
            g.user = User.get_by_id(session['user_id'])
        except User.DoesNotExist:
            session.clear()
            if request.path.startswith('/api/'):
                return jsonify({'error': 'unauthorized'}), 401
            return redirect(url_for('dashboard_routes.login'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'unauthorized'}), 401
            return redirect(url_for('dashboard_routes.login'))
        try:
            g.user = User.get_by_id(session['user_id'])
        except User.DoesNotExist:
            session.clear()
            if request.path.startswith('/api/'):
                return jsonify({'error': 'unauthorized'}), 401
            return redirect(url_for('dashboard_routes.login'))
        if not g.user.is_admin:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'forbidden'}), 403
            return redirect(url_for('dashboard_routes.dashboard'))
        return f(*args, **kwargs)
    return decorated_function

def _user_json(user):
    return {'id': user.id, 'username': user.username, 'is_admin': user.is_admin}

@auth_routes.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    user = User.get_or_none(User.username == username)
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'invalid username or password'}), 401

    session['user_id'] = user.id
    return jsonify({'user': _user_json(user)})


@auth_routes.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'logged out'})

@auth_routes.route('/api/auth/me')
def me():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    try:
        user = User.get_by_id(session['user_id'])
        return jsonify({'user': _user_json(user)})
    except User.DoesNotExist:
        session.clear()
        return jsonify({'error': 'unauthorized'}), 401

@auth_routes.route('/api/users', methods=['GET'])
@admin_required
def list_users():
    users = User.select().order_by(User.created_at)
    return jsonify({'users': [_user_json(u) for u in users]})

@auth_routes.route('/api/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    is_admin = data.get('is_admin', False)

    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400
    if len(username) < 3:
        return jsonify({'error': 'username must be at least 3 characters'}), 400
    if len(password) < 4:
        return jsonify({'error': 'password must be at least 4 characters'}), 400

    if User.select().where(User.username == username).exists():
        return jsonify({'error': 'username already taken'}), 409

    user = User.create(
        username=username,
        password_hash=generate_password_hash(password),
        is_admin=bool(is_admin),
    )
    return jsonify({'user': _user_json(user)}), 201

@auth_routes.route('/api/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    user = User.get_or_none(User.id == user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404

    data = request.get_json()

    if 'username' in data:
        username = data['username'].strip()
        if not username or len(username) < 3:
            return jsonify({'error': 'username must be at least 3 characters'}), 400
        existing = User.get_or_none(User.username == username, User.id != user_id)
        if existing:
            return jsonify({'error': 'username already taken'}), 409
        user.username = username

    if 'password' in data and data['password']:
        if len(data['password']) < 4:
            return jsonify({'error': 'password must be at least 4 characters'}), 400
        user.password_hash = generate_password_hash(data['password'])

    if 'is_admin' in data:
        user.is_admin = bool(data['is_admin'])

    user.save()
    return jsonify({'user': _user_json(user)})

@auth_routes.route('/api/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    if user_id == g.user.id:
        return jsonify({'error': 'cannot delete yourself'}), 400

    user = User.get_or_none(User.id == user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404

    from flask import current_app
    from .database import Listener as ListenerModel
    for lst in ListenerModel.select().where(ListenerModel.user == user, ListenerModel.is_active == True):
        current_app.manager.stop_listener(lst.id)

    user.delete_instance(recursive=True)
    return jsonify({'message': 'user deleted'})
