#!/usr/bin/env python3
import argparse
import json
import os
import random
import ssl
import string
import sys
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def gen_id():
	return uuid.uuid4().hex


def derive_chat_base(api_base: str) -> str:
	if api_base.endswith("/api"):
		return api_base[:-4]
	return api_base


def _format_http_error(err: HTTPError) -> str:
	try:
		body = err.read().decode("utf-8", "replace")
	except Exception:
		body = ""
	parts = [f"HTTP {err.code} {err.reason} for {err.url}"]
	if body:
		parts.append(f"Response body: {body}")
	return "\n".join(parts)


def http_json(method, url, data=None, headers=None, timeout=30):
	headers = headers or {}
	body = None
	if data is not None:
		body = json.dumps(data).encode("utf-8")
		headers.setdefault("Content-Type", "application/json")
	req = Request(url, data=body, method=method)
	for k, v in headers.items():
		req.add_header(k, v)
	try:
		with urlopen(req, context=ssl.create_default_context(), timeout=timeout) as resp:
			raw = resp.read()
			if not raw:
				return None
			try:
				return json.loads(raw.decode("utf-8"))
			except json.JSONDecodeError:
				return {"raw": raw.decode("utf-8", "replace")}
	except HTTPError as err:
		print(_format_http_error(err), file=sys.stderr)
		raise
	except URLError as err:
		print(f"Request failed for {url}: {err}", file=sys.stderr)
		raise


def http_get_json(url, params=None, headers=None, timeout=30):
	if params:
		query = urlencode(params, doseq=True)
		url = f"{url}?{query}"
	return http_json("GET", url, None, headers, timeout)


def open_sse(url, data, headers=None, timeout=3600):
	headers = headers or {}
	headers.setdefault("Content-Type", "application/json")
	headers.setdefault("Accept", "text/event-stream")
	body = json.dumps(data).encode("utf-8")
	req = Request(url, data=body, method="POST")
	for k, v in headers.items():
		req.add_header(k, v)
	try:
		return urlopen(req, context=ssl.create_default_context(), timeout=timeout)
	except HTTPError as err:
		print(_format_http_error(err), file=sys.stderr)
		raise
	except URLError as err:
		print(f"SSE request failed for {url}: {err}", file=sys.stderr)
		raise


def sse_events(resp):
	buf = []
	while True:
		line = resp.readline()
		if not line:
			break
		text = line.decode("utf-8", "replace").strip()
		if not text:
			if buf:
				yield "\n".join(buf)
				buf.clear()
			continue
		if text.startswith("data:"):
			buf.append(text[5:].lstrip())


def pick_provider(api_base, headers):
	res = http_get_json(f"{api_base}/providers", params={"prefer": "true"}, headers=headers)
	items = None
	if isinstance(res, dict):
		if "items" in res:
			items = res["items"]
		elif "data" in res and isinstance(res["data"], dict):
			items = res["data"].get("items")
	if not items:
		raise RuntimeError("No provider found via /api/providers?prefer=true")
	p = items[0]
	model_platform = p.get("provider_name")
	model_type = p.get("model_type")
	api_key = p.get("api_key")
	api_url = p.get("endpoint_url") or p.get("api_url") or ""
	return model_platform, model_type, api_key, api_url


def login_and_get_token(api_base, email, password):
	payload = {
		"email": email,
		"password": password,
	}
	res = http_json("POST", f"{api_base}/login", payload)
	if not isinstance(res, dict):
		raise RuntimeError("Login failed: unexpected response")
	if "token" in res:
		return res["token"]
	if res.get("code"):
		raise RuntimeError(f"Login failed: {res.get('text') or res.get('code')}")
	raise RuntimeError("Login failed: token not found")


def default_task_file():
	return os.path.join(os.path.dirname(__file__), "task_description.json")


def load_tasks(task_file, categories=None, task_names=None):
	with open(task_file, "r", encoding="utf-8") as f:
		data = json.load(f)
	categories = set(categories or [])
	task_names = set(task_names or [])
	tasks = []
	for project_id, entries in data.items():
		if categories and project_id not in categories:
			continue
		if not isinstance(entries, list):
			continue
		for entry in entries:
			if not isinstance(entry, dict):
				continue
			task_id = entry.get("name")
			question = entry.get("description")
			if not task_id or not question:
				continue
			if task_names and task_id not in task_names:
				continue
			tasks.append((project_id, task_id, question))
	return tasks


def generate_suffix(length=4):
	chars = string.ascii_lowercase + string.digits
	return "".join(random.SystemRandom().choice(chars) for _ in range(length))


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--api-base", default="https://dev.eigent.ai/api")
	parser.add_argument("--chat-base", default=None)
	parser.add_argument("--token", default="")
	parser.add_argument("--email", default="benchmark@example.com")
	parser.add_argument("--password", default="")
	parser.add_argument("--task-file", default=default_task_file())
	parser.add_argument("--category", default="")
	parser.add_argument("--task-name", default="")
	parser.add_argument("--language", default="zh-cn")
	parser.add_argument("--model-source", choices=["provider", "manual"], default="provider")
	parser.add_argument("--model-platform", default="")
	parser.add_argument("--model-type", default="")
	parser.add_argument("--api-key", default="")
	parser.add_argument("--api-url", default="")
	parser.add_argument("--skip-history", action="store_true")
	args = parser.parse_args()

	api_base = args.api_base.rstrip("/")
	chat_base = args.chat_base.rstrip("/") if args.chat_base else derive_chat_base(api_base)

	headers_api = {}
	headers_chat = {}
	token = args.token
	needs_api = args.model_source == "provider" or not args.skip_history
	if needs_api:
		if not token and args.password:
			token = login_and_get_token(api_base, args.email, args.password)
		if not token:
			raise RuntimeError("Token is required for provider lookup or history. Provide --token or --password.")
	if token:
		headers_api["Authorization"] = f"Bearer {token}"
		headers_chat["Authorization"] = f"Bearer {token}"

	chat_email = args.email or "benchmark@example.com"

	if args.model_source == "provider":
		model_platform, model_type, api_key, api_url = pick_provider(api_base, headers_api)
	else:
		if not (args.model_platform and args.model_type and args.api_key):
			raise RuntimeError("manual 模式需要 --model-platform --model-type --api-key")
		model_platform = args.model_platform
		model_type = args.model_type
		api_key = args.api_key
		api_url = args.api_url

	print(f"[info] model_platform={model_platform} model_type={model_type}")
	categories = [c.strip() for c in args.category.split(",") if c.strip()]
	task_names = [t.strip() for t in args.task_name.split(",") if t.strip()]
	tasks = load_tasks(args.task_file, categories=categories, task_names=task_names)
	if not tasks:
		raise RuntimeError("No tasks found in task_description.json")

	run_suffix = generate_suffix(4)

	for project_id, task_id, question in tasks:
		project_id = f"{project_id}-{run_suffix}"
		task_id = f"{task_id}-{run_suffix}"
		print(f"[info] project_id={project_id} task_id={task_id}")
		if not args.skip_history:
			history_payload = {
				"project_id": project_id,
				"task_id": task_id,
				"question": question,
				"language": args.language,
				"model_platform": model_platform,
				"model_type": model_type,
				"api_key": api_key,
				"api_url": api_url or "",
				"max_retries": 3,
				"file_save_path": "string",
				"installed_mcp": "string",
				"status": 1,
				"tokens": 0
			}
			history_res = http_json("POST", f"{api_base}/chat/history", history_payload, headers_api)
			if isinstance(history_res, dict) and history_res.get("id"):
				print(f"[info] history_id={history_res['id']}")

		chat_payload = {
			"task_id": task_id,
			"project_id": project_id,
			"question": question,
			"email": chat_email,
			"attaches": [],
			"model_platform": model_platform,
			"model_type": model_type,
			"api_key": api_key,
			"api_url": api_url or None,
			"language": args.language,
			"browser_port": 9222,
			"allow_local_system": True,
			"installed_mcp": {"mcpServers": {}},
			"summary_prompt": "",
			"new_agents": [],
			"env_path": ""
		}

		print(f"[info] open SSE: {chat_base}/chat")
		resp = open_sse(f"{chat_base}/chat", chat_payload, headers_chat)
		content_type = resp.headers.get("Content-Type", "")
		if "text/event-stream" not in content_type:
			body = resp.read().decode("utf-8", "replace")
			print(f"[warn] Non-SSE response: status={resp.status} content-type={content_type} body={body}")
			resp.close()
			continue

		started = False
		received_event = False
		for data in sse_events(resp):
			try:
				payload = json.loads(data)
			except json.JSONDecodeError:
				print(f"[sse] {data}")
				continue
			received_event = True
			step = payload.get("step")
			if step:
				print(f"[sse] step={step}")
			if step == "to_sub_tasks" and not started:
				sub_tasks = payload.get("data", {}).get("sub_tasks") or []
				task_list = []
				for t in sub_tasks:
					content = (t or {}).get("content", "")
					if content.strip():
						task_list.append({"id": (t or {}).get("id", ""), "content": content})
				if task_list:
					print("[info] send /task/{project_id} update")
					http_json("PUT", f"{chat_base}/task/{project_id}", {"task": task_list}, headers_chat)
					print("[info] send /task/{project_id}/start")
					http_json("POST", f"{chat_base}/task/{project_id}/start", {}, headers_chat)
					started = True
				else:
					print("[warn] to_sub_tasks but no valid sub_tasks content")
			if step == "end":
				print("[info] SSE end")
				break
		if not received_event:
			print("[warn] SSE closed without any events")
		resp.close()


if __name__ == "__main__":
	try:
		main()
	except Exception as e:
		print(f"[error] {e}")
		sys.exit(1)
