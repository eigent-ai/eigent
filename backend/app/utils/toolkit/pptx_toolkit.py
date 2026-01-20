import asyncio
import os
import subprocess
import json
from camel.toolkits import PPTXToolkit as BasePPTXToolkit

from app.component.environment import env
from app.service.task import ActionWriteFileData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit, _safe_put_queue
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task
from app.utils.json_utils import ensure_json_string


@auto_listen_toolkit(BasePPTXToolkit)
class PPTXToolkit(BasePPTXToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(working_directory, timeout)

    @listen_toolkit(
        BasePPTXToolkit.create_presentation,
        lambda _,
        content,
        filename,
        template=None: f"create presentation with content: {content}, filename: {filename}, template: {template}",
    )
    def create_presentation(self, content: str, filename: str, template: str | None = None) -> str:
        if not filename.lower().endswith(".pptx"):
            filename += ".pptx"

        file_path = self._resolve_filepath(filename)
        
        # Determine project root fallback if env var is missing
        # This file is in backend/app/utils/toolkit/
        # We need to go up 4 levels to get to backend/, then one more for repo root if scripts is in root
        # Actually structure is:
        # eigent/
        #   backend/
        #   scripts/
        # So we need to reach 'eigent/'
        default_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../"))
        project_root = env("project_root", default_root)
        
        script_path = os.path.join(project_root, "scripts", "generate_pptx.js")
        
        try:
             # Ensure content is a valid JSON string using helper
             try:
                 content_str = ensure_json_string(content)
             except json.JSONDecodeError:
                 return "Error: Content must be valid JSON string representing slides."

             # Run node script
             result = subprocess.run(
                 ["node", script_path, str(file_path), content_str],
                 capture_output=True,
                 text=True,
                 check=True
             )
             res = result.stdout.strip()
             
             # If successful, queue the file write action
             if "PowerPoint presentation successfully created" in res:
                task_lock = get_task_lock(self.api_task_id)
                # Capture ContextVar value before creating async task
                # We need to capture the current process_task_id context variable so we can 
                # pass it to the async task execution, ensuring the action is associated with the correct task
                current_process_task_id = process_task.get("")

                # Use _safe_put_queue to handle both sync and async contexts
                _safe_put_queue(
                    task_lock,
                    ActionWriteFileData(process_task_id=current_process_task_id, data=str(file_path))
                )
             return res

        except subprocess.CalledProcessError as e:
            return f"Error creating presentation: {e.stderr}"
        except Exception as e:
            return f"Error creating presentation: {str(e)}"
