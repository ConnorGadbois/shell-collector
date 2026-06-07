import os
import peewee
from datetime import datetime

db_path = os.environ.get('DATABASE_PATH', 'shell_collector.db')
db = peewee.SqliteDatabase(db_path, check_same_thread=False)


class BaseModel(peewee.Model):
    class Meta:
        database = db

class User(BaseModel):
    username = peewee.CharField(unique=True, max_length=80)
    password_hash = peewee.CharField(max_length=256)
    is_admin = peewee.BooleanField(default=False)
    created_at = peewee.DateTimeField(default=datetime.now)

class Listener(BaseModel):
    user = peewee.ForeignKeyField(User, backref='listeners')
    address = peewee.CharField(max_length=45)
    port = peewee.IntegerField()
    created_at = peewee.DateTimeField(default=datetime.now)
    is_active = peewee.BooleanField(default=False)

class ShellClient(BaseModel):
    listener = peewee.ForeignKeyField(Listener, backref='shells')
    user = peewee.ForeignKeyField(User, backref='shells')
    hostname = peewee.CharField(max_length=256, default='')
    ip_address = peewee.CharField(max_length=45)
    platform = peewee.CharField(max_length=100, default='')
    connected_at = peewee.DateTimeField(default=datetime.now)
    last_seen = peewee.DateTimeField(default=datetime.now)
    is_active = peewee.BooleanField(default=True)

class Command(BaseModel):
    shell = peewee.ForeignKeyField(ShellClient, backref='commands')
    user = peewee.ForeignKeyField(User, backref='commands')
    command_text = peewee.TextField()
    output_text = peewee.TextField(default='')
    sent_at = peewee.DateTimeField(default=datetime.now)
    completed_at = peewee.DateTimeField(null=True)

class Setting(BaseModel):
    key = peewee.CharField(unique=True, max_length=128)
    value = peewee.TextField(default='')

def initialize_database():
    db.connect()
    db.create_tables([User, Listener, ShellClient, Command, Setting], safe=True)
    try:
        db.execute_sql('ALTER TABLE user ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
    except Exception:
        pass
