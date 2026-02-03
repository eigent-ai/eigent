import pytest
from unittest.mock import MagicMock, patch
import json
import os
import subprocess
from app.utils.toolkit.pptx_toolkit import PPTXToolkit
from app.service.task import ActionWriteFileData

@pytest.fixture
def pptx_toolkit():
    # Mocking environment to avoid real file system access during init if needed
    with patch("app.utils.toolkit.pptx_toolkit.env") as mock_env:
        mock_env.return_value = "/tmp/downloads"
        return PPTXToolkit(api_task_id="test_task_id")

@patch("app.utils.toolkit.pptx_toolkit.subprocess.run")
@patch("app.utils.toolkit.pptx_toolkit.get_task_lock")
@patch("app.utils.toolkit.pptx_toolkit.process_task")
@patch("app.utils.toolkit.pptx_toolkit._safe_put_queue")
@patch("app.utils.toolkit.pptx_toolkit.env")
def test_create_presentation_success(mock_env, mock_safe_put, mock_process_task, mock_get_task_lock, mock_subprocess, pptx_toolkit):
    # Setup mocks
    # return a project root when queried
    def env_side_effect(key, default=None):
        if key == "project_root":
            return "/mock/project/root"
        return default
    mock_env.side_effect = env_side_effect
    
    mock_subprocess_result = MagicMock()
    mock_subprocess_result.stdout = "PowerPoint presentation successfully created"
    mock_subprocess.return_value = mock_subprocess_result
    
    mock_process_task.get.return_value = "test_process_id"
    
    # Test execution
    content = {"slides": [{"title": "Test Slide"}]}
    filename = "test_presentation"
    
    # We pass JSON string as expected
    result = pptx_toolkit.create_presentation(json.dumps(content), filename)
    
    # Assertions
    assert "PowerPoint presentation successfully created" in result
    
    # Verify subprocess call
    # The script path should be constructed with the mock project root
    args = mock_subprocess.call_args[0][0]
    assert args[0] == "node"
    assert "scripts/generate_pptx.js" in args[1] 
    assert args[1].startswith("/mock/project/root")
    assert args[3] == json.dumps(content)
    
    # Verify task queue interaction
    mock_get_task_lock.assert_called_with("test_task_id")
    mock_safe_put.assert_called_once()
    
    # Check ActionWriteFileData
    call_args = mock_safe_put.call_args
    # _safe_put_queue(task_lock, action)
    action = call_args[0][1]
    assert isinstance(action, ActionWriteFileData)
    assert action.process_task_id == "test_process_id"
    assert action.data.endswith(".pptx")

@patch("app.utils.toolkit.pptx_toolkit.subprocess.run")
def test_create_presentation_json_error(mock_subprocess, pptx_toolkit):
    # Invalid JSON string
    result = pptx_toolkit.create_presentation("{invalid_json", "test.pptx")
    assert "Error: Content must be valid JSON string" in result
    mock_subprocess.assert_not_called()

@patch("app.utils.toolkit.pptx_toolkit.subprocess.run")
@patch("app.utils.toolkit.pptx_toolkit.env")
def test_create_presentation_subprocess_error(mock_env, mock_subprocess, pptx_toolkit):
    mock_env.return_value = "/mock/root"
    
    mock_subprocess.side_effect = subprocess.CalledProcessError(1, ["node"], stderr="Script failed")
    
    result = pptx_toolkit.create_presentation("{}", "test.pptx")
    assert "Error creating presentation: Script failed" in result

@patch("app.utils.toolkit.pptx_toolkit.subprocess.run")
@patch("app.utils.toolkit.pptx_toolkit.env")
def test_create_presentation_content_handling(mock_env, mock_subprocess, pptx_toolkit):
    """Test that dictionary content is automatically converted to JSON string"""
    mock_env.return_value = "/mock/root"
    mock_subprocess_result = MagicMock()
    mock_subprocess_result.stdout = "PowerPoint presentation successfully created"
    mock_subprocess.return_value = mock_subprocess_result
    
    content = {"title": "Test"}
    pptx_toolkit.create_presentation(content, "test.pptx") # Passing dict directly
    
    content_arg = mock_subprocess.call_args[0][0][3]
    assert content_arg == json.dumps(content)
