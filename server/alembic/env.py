# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import pathlib
import sys
from logging.config import fileConfig

# Add project root to Python path to import shared utils
_project_root = pathlib.Path(__file__).parent.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from alembic import context
from app.component.environment import auto_import, env_not_empty

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
auto_import("app.model.mcp")
auto_import("app.model.user")
auto_import("app.model.config")
auto_import("app.model.chat")
auto_import("app.model.provider")

# target_metadata = mymodel.Base.metadata
target_metadata = SQLModel.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


# https://alembic.sqlalchemy.org/en/latest/autogenerate.html#affecting-the-rendering-of-types-themselves
def render_item(type_, obj, autogen_context):
    """Apply rendering for custom sqlalchemy types"""
    if type_ == "type":
        module_name = obj.__class__.__module__
        if module_name.startswith("sqlalchemy_utils."):
            return render_sqlalchemy_utils_type(obj, autogen_context)

    # render default
    return False


def render_sqlalchemy_utils_type(obj, autogen_context):
    class_name = obj.__class__.__name__
    import_statement = f"from sqlalchemy_utils.types import {class_name}"
    autogen_context.imports.add(import_statement)
    if class_name == "ChoiceType":
        return render_choice_type(obj, autogen_context)
    return f"{class_name}()"


def render_choice_type(obj, autogen_context):
    choices = obj.choices
    if obj.type_impl.__class__.__name__ == "EnumTypeImpl":
        choices = obj.type_impl.enum_class.__name__
        import_statement = f"from {obj.type_impl.enum_class.__module__} import {choices}"
        autogen_context.imports.add(import_statement)
    impl_stmt = f"sa.{obj.impl.__class__.__name__}()"
    return f"{obj.__class__.__name__}(choices={choices}, impl={impl_stmt})"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def include_object(object, name, type_, reflected, compare_to):
    # ignore all foreign key constraints
    if type_ == "foreign_key_constraint":
        return False
    return True


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    options = config.get_section(config.config_ini_section, {})
    options["sqlalchemy.url"] = env_not_empty("database_url")
    connectable = engine_from_config(
        options,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            render_item=render_item,
            include_object=include_object,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
