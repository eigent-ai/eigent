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

"""Database-owned opaque Provider revisions, independent of secret values.

Triggers cover ORM, bulk and raw SQL writes, including older CRUD clients.
Changing preference alone does not invalidate a pinned provider. Rollback also
rolls back the revision; deleted/re-created rows receive a fresh identity.
"""

from sqlalchemy import text

FIELDS = "user_id, provider_name, model_type, api_key, endpoint_url, encrypted_config, is_vaild, deleted_at"


def install_execution_revision_triggers(connection):
    dialect = connection.dialect.name
    if dialect == "sqlite":
        connection.execute(
            text("""
            CREATE TRIGGER provider_execution_revision_insert AFTER INSERT ON provider
            BEGIN
                UPDATE provider SET execution_revision = lower(hex(randomblob(16)))
                WHERE id = NEW.id;
            END
        """)
        )
        connection.execute(
            text(f"""
            CREATE TRIGGER provider_execution_revision_update AFTER UPDATE OF {FIELDS} ON provider
            BEGIN
                UPDATE provider SET execution_revision = lower(hex(randomblob(16)))
                WHERE id = NEW.id;
            END
        """)
        )
    elif dialect == "postgresql":
        # The repository's server deployment uses PostgreSQL 15.
        connection.execute(
            text("""
            CREATE FUNCTION rotate_provider_execution_revision() RETURNS trigger AS $$
            BEGIN
                NEW.execution_revision := replace(gen_random_uuid()::text, '-', '');
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """)
        )
        connection.execute(
            text(f"""
            CREATE TRIGGER provider_execution_revision_write
            BEFORE INSERT OR UPDATE OF {FIELDS} ON provider
            FOR EACH ROW EXECUTE FUNCTION rotate_provider_execution_revision()
        """)
        )
    else:
        raise RuntimeError("Provider execution revisions require PostgreSQL or SQLite")


def remove_execution_revision_triggers(connection):
    if connection.dialect.name == "sqlite":
        connection.execute(text("DROP TRIGGER provider_execution_revision_insert"))
        connection.execute(text("DROP TRIGGER provider_execution_revision_update"))
    elif connection.dialect.name == "postgresql":
        connection.execute(text("DROP TRIGGER provider_execution_revision_write ON provider"))
        connection.execute(text("DROP FUNCTION rotate_provider_execution_revision()"))
    else:
        raise RuntimeError("Unsupported Provider revision database")


def after_create(_table, connection, **_kwargs):
    install_execution_revision_triggers(connection)
