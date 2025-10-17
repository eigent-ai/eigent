from typing import Any, Dict, List, Literal, Optional, Union

from camel.toolkits import GmailToolkit as BaseGmailToolkit
from camel.toolkits.function_tool import FunctionTool
from loguru import logger

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class GoogleGmailNativeToolkit(BaseGmailToolkit, AbstractToolkit):
    """Eigent wrapper for CAMEL's native Gmail toolkit."""
    
    agent_name: str = Agents.social_medium_agent

    def __init__(
        self,
        api_task_id: str,
        timeout: Optional[float] = None,
    ):
        """Initialize the Gmail toolkit.
        
        Args:
            api_task_id: The task ID for tracking
            timeout: Optional timeout for API requests
        """
        self.api_task_id = api_task_id
        super().__init__(timeout=timeout)

    # Email Sending Operations
    @listen_toolkit(
        BaseGmailToolkit.send_email,
        lambda _, to, subject, **kwargs: f"Sending email to '{to}' with subject '{subject}'"
    )
    def send_email(
        self,
        to: Union[str, List[str]],
        subject: str,
        body: str,
        cc: Optional[Union[str, List[str]]] = None,
        bcc: Optional[Union[str, List[str]]] = None,
        attachments: Optional[List[str]] = None,
        is_html: bool = False,
    ) -> Dict[str, Any]:
        return super().send_email(to, subject, body, cc, bcc, attachments, is_html)

    @listen_toolkit(
        BaseGmailToolkit.reply_to_email,
        lambda _, message_id, reply_body, **kwargs: f"Replying to message {message_id}"
    )
    def reply_to_email(
        self,
        message_id: str,
        reply_body: str,
        reply_all: bool = False,
        is_html: bool = False,
    ) -> Dict[str, Any]:
        return super().reply_to_email(message_id, reply_body, reply_all, is_html)

    @listen_toolkit(
        BaseGmailToolkit.forward_email,
        lambda _, message_id, to, **kwargs: f"Forwarding message {message_id} to '{to}'"
    )
    def forward_email(
        self,
        message_id: str,
        to: Union[str, List[str]],
        forward_body: Optional[str] = None,
        cc: Optional[Union[str, List[str]]] = None,
        bcc: Optional[Union[str, List[str]]] = None,
        include_attachments: bool = True,
    ) -> Dict[str, Any]:
        return super().forward_email(message_id, to, forward_body, cc, bcc, include_attachments)

    # Draft Operations
    @listen_toolkit(
        BaseGmailToolkit.create_email_draft,
        lambda _, to, subject, **kwargs: f"Creating draft to '{to}' with subject '{subject}'"
    )
    def create_email_draft(
        self,
        to: Union[str, List[str]],
        subject: str,
        body: str,
        cc: Optional[Union[str, List[str]]] = None,
        bcc: Optional[Union[str, List[str]]] = None,
        attachments: Optional[List[str]] = None,
        is_html: bool = False,
    ) -> Dict[str, Any]:
        return super().create_email_draft(to, subject, body, cc, bcc, attachments, is_html)

    @listen_toolkit(
        BaseGmailToolkit.send_draft,
        lambda _, draft_id: f"Sending draft {draft_id}"
    )
    def send_draft(self, draft_id: str) -> Dict[str, Any]:
        return super().send_draft(draft_id)

    @listen_toolkit(
        BaseGmailToolkit.list_drafts,
        lambda _, max_results=10: f"Listing {max_results} drafts"
    )
    def list_drafts(self, max_results: int = 10) -> Dict[str, Any]:
        return super().list_drafts(max_results)

    # Email Fetching Operations
    @listen_toolkit(
        BaseGmailToolkit.fetch_emails,
        lambda _, query="", max_results=10, **kwargs: f"Fetching {max_results} emails with query '{query}'"
    )
    def fetch_emails(
        self,
        query: str = "",
        max_results: int = 10,
        include_spam_trash: bool = False,
        label_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return super().fetch_emails(query, max_results, include_spam_trash, label_ids)

    @listen_toolkit(
        BaseGmailToolkit.fetch_thread_by_id,
        lambda _, thread_id: f"Fetching thread {thread_id}"
    )
    def fetch_thread_by_id(self, thread_id: str) -> Dict[str, Any]:
        return super().fetch_thread_by_id(thread_id)

    @listen_toolkit(
        BaseGmailToolkit.list_threads,
        lambda _, query="", max_results=10, **kwargs: f"Listing {max_results} threads with query '{query}'"
    )
    def list_threads(
        self,
        query: str = "",
        max_results: int = 10,
        include_spam_trash: bool = False,
        label_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return super().list_threads(query, max_results, include_spam_trash, label_ids)

    # Label Management
    @listen_toolkit(
        BaseGmailToolkit.modify_email_labels,
        lambda _, message_id, add_labels=None, remove_labels=None: 
            f"Modifying labels on message {message_id} (add: {add_labels}, remove: {remove_labels})"
    )
    def modify_email_labels(
        self,
        message_id: str,
        add_labels: Optional[List[str]] = None,
        remove_labels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return super().modify_email_labels(message_id, add_labels, remove_labels)

    @listen_toolkit(
        BaseGmailToolkit.modify_thread_labels,
        lambda _, thread_id, add_labels=None, remove_labels=None:
            f"Modifying labels on thread {thread_id} (add: {add_labels}, remove: {remove_labels})"
    )
    def modify_thread_labels(
        self,
        thread_id: str,
        add_labels: Optional[List[str]] = None,
        remove_labels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return super().modify_thread_labels(thread_id, add_labels, remove_labels)

    @listen_toolkit(
        BaseGmailToolkit.list_gmail_labels,
        lambda _: "Listing all Gmail labels"
    )
    def list_gmail_labels(self) -> Dict[str, Any]:
        return super().list_gmail_labels()

    @listen_toolkit(
        BaseGmailToolkit.create_label,
        lambda _, name, **kwargs: f"Creating label '{name}'"
    )
    def create_label(
        self,
        name: str,
        label_list_visibility: Literal["labelShow", "labelHide"] = "labelShow",
        message_list_visibility: Literal["show", "hide"] = "show",
    ) -> Dict[str, Any]:
        return super().create_label(name, label_list_visibility, message_list_visibility)

    @listen_toolkit(
        BaseGmailToolkit.delete_label,
        lambda _, label_id: f"Deleting label {label_id}"
    )
    def delete_label(self, label_id: str) -> Dict[str, Any]:
        return super().delete_label(label_id)

    # Utility Operations
    @listen_toolkit(
        BaseGmailToolkit.move_to_trash,
        lambda _, message_id: f"Moving message {message_id} to trash"
    )
    def move_to_trash(self, message_id: str) -> Dict[str, Any]:
        return super().move_to_trash(message_id)

    @listen_toolkit(
        BaseGmailToolkit.get_attachment,
        lambda _, message_id, attachment_id, **kwargs: 
            f"Getting attachment {attachment_id} from message {message_id}"
    )
    def get_attachment(
        self,
        message_id: str,
        attachment_id: str,
        save_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        return super().get_attachment(message_id, attachment_id, save_path)

    @listen_toolkit(
        BaseGmailToolkit.get_profile,
        lambda _: "Getting Gmail profile"
    )
    def get_profile(self) -> Dict[str, Any]:
        return super().get_profile()

    # Contact Operations
    @listen_toolkit(
        BaseGmailToolkit.get_contacts,
        lambda _, query="", max_results=100: f"Getting contacts with query '{query}' (max: {max_results})"
    )
    def get_contacts(
        self,
        query: str = "",
        max_results: int = 100,
    ) -> Dict[str, Any]:
        return super().get_contacts(query, max_results)

    @listen_toolkit(
        BaseGmailToolkit.search_people,
        lambda _, query, max_results=10: f"Searching people with query '{query}' (max: {max_results})"
    )
    def search_people(
        self,
        query: str,
        max_results: int = 10,
    ) -> Dict[str, Any]:
        return super().search_people(query, max_results)

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        """Check if Gmail toolkit can be used and return available tools.
        
        Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.
        """
        if not env("GOOGLE_CLIENT_ID") or not env("GOOGLE_CLIENT_SECRET"):
            logger.warning(
                "Gmail toolkit unavailable: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set"
            )
            return []

        try:
            toolkit = cls(api_task_id)
            tools = toolkit.get_tools()
            
            # Mark each tool with the toolkit name for tracking
            for tool in tools:
                setattr(tool, "_toolkit_name", cls.__name__)
            
            logger.info(f"Gmail toolkit initialized with {len(tools)} tools")
            return tools
            
        except Exception as e:
            logger.error(f"Failed to initialize Gmail toolkit: {e}")
            return []

    def get_tools(self) -> List[FunctionTool]:
        """Return all available Gmail tools."""
        return [
            FunctionTool(self.send_email),
            FunctionTool(self.reply_to_email),
            FunctionTool(self.forward_email),
            FunctionTool(self.create_email_draft),
            FunctionTool(self.send_draft),
            FunctionTool(self.list_drafts),
            FunctionTool(self.fetch_emails),
            FunctionTool(self.fetch_thread_by_id),
            FunctionTool(self.list_threads),
            FunctionTool(self.modify_email_labels),
            FunctionTool(self.modify_thread_labels),
            FunctionTool(self.list_gmail_labels),
            FunctionTool(self.create_label),
            FunctionTool(self.delete_label),
            FunctionTool(self.move_to_trash),
            FunctionTool(self.get_attachment),
            FunctionTool(self.get_profile),
            FunctionTool(self.get_contacts),
            FunctionTool(self.search_people),
        ]