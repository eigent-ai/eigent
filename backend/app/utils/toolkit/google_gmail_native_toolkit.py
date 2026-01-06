from typing import Any, Dict, List, Literal, Optional, Union
import os
import threading

from camel.toolkits import GmailToolkit as BaseGmailToolkit
from camel.toolkits.function_tool import FunctionTool

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.utils.oauth_state_manager import oauth_state_manager
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("main")

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/contacts.readonly',
]


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
        self._token_path = (
            env("GOOGLE_GMAIL_TOKEN_PATH")
            or os.path.join(
                os.path.expanduser("~"),
                ".eigent",
                "tokens",
                "google_gmail",
                "google_gmail_token.json",
            )
        )
        super().__init__(timeout=timeout)
    
    @classmethod
    def _build_canonical_token_path(cls) -> str:
        return env("GOOGLE_GMAIL_TOKEN_PATH") or os.path.join(
            os.path.expanduser("~"),
            ".eigent",
            "tokens",
            "google_gmail",
            "google_gmail_token.json",
        )

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
        page_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        return super().list_threads(query, max_results, include_spam_trash, label_ids, page_token)

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

    def _get_gmail_service(self):
        """Get Gmail service with authenticated credentials."""
        from googleapiclient.discovery import build
        from google.auth.transport.requests import Request

        creds = self._authenticate()

        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            try:
                os.makedirs(os.path.dirname(self._token_path), exist_ok=True)
                with open(self._token_path, "w", encoding="utf-8") as f:
                    f.write(creds.to_json())
            except Exception:
                pass

        return build("gmail", "v1", credentials=creds)

    def _authenticate(self):
        """Authenticate with Gmail API using multiple credential sources."""
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        creds = None

        # First, try to load from token file
        try:
            if os.path.exists(self._token_path):
                logger.info(f"Loading credentials from token file: {self._token_path}")
                creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)
                logger.info("Successfully loaded credentials from token file")
        except Exception as e:
            logger.warning(f"Could not load from token file: {e}")
            creds = None

        # If no token file, try environment variables
        if not creds:
            client_id = env("GOOGLE_CLIENT_ID")
            client_secret = env("GOOGLE_CLIENT_SECRET")
            refresh_token = env("GOOGLE_REFRESH_TOKEN")
            token_uri = env("GOOGLE_TOKEN_URI", "https://oauth2.googleapis.com/token")
            
            if refresh_token and client_id and client_secret:
                logger.info("Creating credentials from environment variables")
                creds = Credentials(
                    None,
                    refresh_token=refresh_token,
                    token_uri=token_uri,
                    client_id=client_id,
                    client_secret=client_secret,
                    scopes=SCOPES,
                )

        # If still no creds, check background authorization
        if not creds:
            state = oauth_state_manager.get_state("google_gmail")
            if state and state.status == "success" and state.result:
                logger.info("Using credentials from background authorization")
                creds = state.result
            else:
                # No credentials available
                raise ValueError("No credentials available. Please run authorization first via /api/install/tool/google_gmail")

        # Refresh if expired
        if creds and creds.expired and creds.refresh_token:
            try:
                logger.info("Token expired, refreshing...")
                creds.refresh(Request())
                logger.info("Token refreshed successfully")
            except Exception as e:
                logger.error(f"Failed to refresh token: {e}")
                raise ValueError("Failed to refresh expired token. Please re-authorize.") from e

        # Save credentials
        try:
            os.makedirs(os.path.dirname(self._token_path), exist_ok=True)
            with open(self._token_path, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
        except Exception as e:
            logger.warning(f"Could not save credentials: {e}")

        return creds

    @staticmethod
    def start_background_auth(api_task_id: str = "install_auth") -> str:
        """
        Start background OAuth authorization flow with timeout
        Returns the status of the authorization
        """
        from google_auth_oauthlib.flow import InstalledAppFlow
        
        # Check if there's an existing authorization and force stop it
        old_state = oauth_state_manager.get_state("google_gmail")
        if old_state and old_state.status in ["pending", "authorizing"]:
            logger.info("Found existing authorization, forcing shutdown...")
            old_state.cancel()
            # Try to shutdown the old server if it exists
            if hasattr(old_state, 'server') and old_state.server:
                try:
                    old_state.server.shutdown()
                    logger.info("Old server shutdown successfully")
                except Exception as e:
                    logger.warning(f"Could not shutdown old server: {e}")
        
        # Create new state for this authorization
        state = oauth_state_manager.create_state("google_gmail")
        
        def auth_flow():
            try:
                state.status = "authorizing"
                oauth_state_manager.update_status("google_gmail", "authorizing")
                
                client_id = env("GOOGLE_CLIENT_ID")
                client_secret = env("GOOGLE_CLIENT_SECRET")
                token_uri = env("GOOGLE_TOKEN_URI", "https://oauth2.googleapis.com/token")
                
                logger.info(f"Google Gmail auth - client_id present: {bool(client_id)}, client_secret present: {bool(client_secret)}")
                
                if not client_id or not client_secret:
                    error_msg = "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables"
                    logger.error(error_msg)
                    raise ValueError(error_msg)
                
                client_config = {
                    "installed": {
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": token_uri,
                        "redirect_uris": ["http://localhost"],
                    }
                }
                
                flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
                
                # Check for cancellation before starting
                if state.is_cancelled():
                    logger.info("Authorization cancelled before starting")
                    return
                
                # This will automatically open browser and wait for user authorization
                logger.info("=" * 80)
                logger.info(f"[Thread {threading.current_thread().name}] Starting local server for Google Gmail authorization")
                logger.info("Browser should open automatically in a moment...")
                logger.info("=" * 80)
                
                # Run local server - this will block until authorization completes
                # Note: Each call uses a random port (port=0), so multiple concurrent attempts won't conflict
                try:
                    creds = flow.run_local_server(
                        port=0,
                        authorization_prompt_message="",
                        success_message="<h1>Authorization successful!</h1><p>You can close this window and return to Eigent.</p>",
                        open_browser=True
                    )
                    logger.info("Authorization flow completed successfully!")
                except Exception as server_error:
                    logger.error(f"Error during run_local_server: {server_error}")
                    raise
                
                # Check for cancellation after auth
                if state.is_cancelled():
                    logger.info("Authorization cancelled after completion")
                    return
                
                # Save credentials to token file
                token_path = os.path.join(
                    os.path.expanduser("~"),
                    ".eigent",
                    "tokens",
                    "google_gmail",
                    f"google_gmail_token.json",
                )
                
                try:
                    os.makedirs(os.path.dirname(token_path), exist_ok=True)
                    with open(token_path, "w", encoding="utf-8") as f:
                        f.write(creds.to_json())
                    logger.info(f"Saved Google Gmail credentials to {token_path}")
                except Exception as e:
                    logger.warning(f"Could not save credentials: {e}")
                
                # Update state with success
                oauth_state_manager.update_status("google_gmail", "success", result=creds)
                logger.info("Google Gmail authorization successful!")
                
            except Exception as e:
                if state.is_cancelled():
                    logger.info("Authorization was cancelled")
                    oauth_state_manager.update_status("google_gmail", "cancelled")
                else:
                    error_msg = str(e)
                    logger.error(f"Google Gmail authorization failed: {error_msg}")
                    oauth_state_manager.update_status("google_gmail", "failed", error=error_msg)
            finally:
                # Clean up server reference
                state.server = None
        
        # Start authorization in background thread
        thread = threading.Thread(target=auth_flow, daemon=True, name=f"GoogleGmail-OAuth-{state.started_at.timestamp()}")
        state.thread = thread
        thread.start()
        
        logger.info("Started background Google Gmail authorization")
        return "authorizing"

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        """Check if Gmail toolkit can be used and return available tools.
        
        Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.
        """
        if env("GOOGLE_CLIENT_ID") and env("GOOGLE_CLIENT_SECRET"):
            return cls(api_task_id).get_tools()
        else:
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