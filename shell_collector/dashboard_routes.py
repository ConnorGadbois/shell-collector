from flask import Blueprint, render_template

from .auth_routes import login_required, admin_required

dashboard_routes = Blueprint('dashboard_routes', __name__)

@dashboard_routes.route('/login')
def login():
    return render_template('login.html')

@dashboard_routes.route('/')
@login_required
def dashboard():
    return render_template('dashboard.html')

@dashboard_routes.route('/settings')
@admin_required
def settings():
    return render_template('settings.html')
