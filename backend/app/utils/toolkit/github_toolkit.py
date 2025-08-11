from typing import Literal
from camel.toolkits import GithubToolkit as BaseGithubToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class GithubToolkit(BaseGithubToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(
        self,
        api_task_id: str,
        access_token: str | None = None,
        timeout: float | None = None,
    ) -> None:
        super().__init__(access_token, timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseGithubToolkit.create_pull_request,
        lambda _,
        repo_name,
        file_path,
        new_content,
        pr_title,
        body,
        branch_name: f"Create PR in {repo_name} for {file_path} with title '{pr_title}', branch '{branch_name}', content '{new_content}'",
    )
    def create_pull_request(
        self,
        repo_name: str,
        file_path: str,
        new_content: str,
        pr_title: str,
        body: str,
        branch_name: str,
    ) -> str:
        return super().create_pull_request(repo_name, file_path, new_content, pr_title, body, branch_name)

    @listen_toolkit(
        BaseGithubToolkit.get_issue_list,
        lambda _, repo_name, state="all": f"Get issue list from {repo_name} with state '{state}'",
        lambda issues: f"Retrieved {len(issues)} issues",
    )
    def get_issue_list(
        self, repo_name: str, state: Literal["open", "closed", "all"] = "all"
    ) -> list[dict[str, object]]:
        return super().get_issue_list(repo_name, state)

    @listen_toolkit(
        BaseGithubToolkit.get_issue_content,
        lambda _, repo_name, issue_number: f"Get content of issue {issue_number} from {repo_name}",
    )
    def get_issue_content(self, repo_name: str, issue_number: int) -> str:
        return super().get_issue_content(repo_name, issue_number)

    @listen_toolkit(
        BaseGithubToolkit.get_pull_request_list,
        lambda _, repo_name, state="all": f"Get pull request list from {repo_name} with state '{state}'",
        lambda prs: f"Retrieved {len(prs)} pull requests",
    )
    def get_pull_request_list(
        self, repo_name: str, state: Literal["open", "closed", "all"] = "all"
    ) -> list[dict[str, object]]:
        return super().get_pull_request_list(repo_name, state)

    @listen_toolkit(
        BaseGithubToolkit.get_pull_request_code,
        lambda _, repo_name, pr_number: f"Get code for pull request {pr_number} in {repo_name}",
        lambda code: f"Retrieved {len(code)} code files",
    )
    def get_pull_request_code(self, repo_name: str, pr_number: int) -> list[dict[str, str]]:
        return super().get_pull_request_code(repo_name, pr_number)

    @listen_toolkit(
        BaseGithubToolkit.get_pull_request_comments,
        lambda _, repo_name, pr_number: f"Get comments for pull request {pr_number} in {repo_name}",
        lambda comments: f"Retrieved {len(comments)} comments",
    )
    def get_pull_request_comments(self, repo_name: str, pr_number: int) -> list[dict[str, str]]:
        return super().get_pull_request_comments(repo_name, pr_number)

    @listen_toolkit(
        BaseGithubToolkit.get_all_file_paths,
        lambda _, repo_name, path="": f"Get all file paths from {repo_name}, path '{path}'",
        lambda paths: f"Retrieved {len(paths)} file paths",
    )
    def get_all_file_paths(self, repo_name: str, path: str = "") -> list[str]:
        return super().get_all_file_paths(repo_name, path)

    @listen_toolkit(
        BaseGithubToolkit.retrieve_file_content,
        lambda _, repo_name, file_path: f"Retrieve content of file {file_path} from {repo_name}",
        lambda content: f"Retrieved content of length {len(content)}",
    )
    def retrieve_file_content(self, repo_name: str, file_path: str) -> str:
        return super().retrieve_file_content(repo_name, file_path)

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        if env("GITHUB_ACCESS_TOKEN"):
            return GithubToolkit(api_task_id).get_tools()
        else:
            return []
