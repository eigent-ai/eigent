// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import cursorIcon from '@/assets/icon/cursor.svg';
import githubIcon from '@/assets/icon/github.svg';
import googleCalendarIcon from '@/assets/icon/google_calendar.svg';
import googleGmailIcon from '@/assets/icon/google_gmail.svg';
import larkIcon from '@/assets/icon/lark.png';
import linkedinIcon from '@/assets/icon/linkedin.svg';
import notionIcon from '@/assets/icon/notion.svg';
import ragIcon from '@/assets/icon/rag.svg';
import redditIcon from '@/assets/icon/reddit.svg';
import slackIcon from '@/assets/icon/slack.svg';
import telegramIcon from '@/assets/icon/telegram.svg';
import vsCodeIcon from '@/assets/icon/vs-code.svg';
import whatsappIcon from '@/assets/icon/whatsapp.svg';
import xIcon from '@/assets/icon/x.svg';

/**
 * Brand logo per built-in integration key, keyed by the lowercased,
 * trimmed name returned from `/api/v1/config/info` (matches the Connectors
 * settings page). Shared so any connector-picking UI (Settings, chat input
 * picker, etc.) shows the same logos.
 */
export const INTEGRATION_ICON_BY_KEY: Record<string, string> = {
  notion: notionIcon,
  slack: slackIcon,
  'google calendar': googleCalendarIcon,
  gmail: googleGmailIcon,
  'google gmail': googleGmailIcon,
  linkedin: linkedinIcon,
  lark: larkIcon,
  rag: ragIcon,
  telegram: telegramIcon,
  whatsapp: whatsappIcon,
  x: xIcon,
  'x(twitter)': xIcon,
  twitter: xIcon,
  reddit: redditIcon,
  github: githubIcon,
  cursor: cursorIcon,
  'vs code': vsCodeIcon,
  vscode: vsCodeIcon,
};

/** Looks up a built-in integration's brand logo by name (case/whitespace-insensitive). */
export function integrationLeadingIconUrl(
  integrationKey: string
): string | undefined {
  return INTEGRATION_ICON_BY_KEY[integrationKey.toLowerCase().trim()];
}
