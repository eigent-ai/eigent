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

import {
  BookOpen,
  Briefcase,
  Camera,
  ChartColumn,
  Code,
  Coffee,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  Leaf,
  Lightbulb,
  Megaphone,
  Music,
  Palette,
  Plane,
  Rocket,
  Shield,
  ShoppingCart,
  Star,
  Terminal,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/** The icons a Space can use. The ids are stored, so keep them stable. */
export const SPACE_ICONS: Readonly<Record<string, LucideIcon>> = {
  folder: Folder,
  rocket: Rocket,
  code: Code,
  terminal: Terminal,
  book: BookOpen,
  briefcase: Briefcase,
  flask: FlaskConical,
  chart: ChartColumn,
  globe: Globe,
  megaphone: Megaphone,
  lightbulb: Lightbulb,
  palette: Palette,
  camera: Camera,
  music: Music,
  users: Users,
  graduation: GraduationCap,
  wallet: Wallet,
  cart: ShoppingCart,
  plane: Plane,
  coffee: Coffee,
  leaf: Leaf,
  heart: Heart,
  star: Star,
  shield: Shield,
};

export const SPACE_ICON_IDS = Object.keys(SPACE_ICONS);

/** A Space's chosen icon id, ignoring anything this version doesn't know. */
export function spaceIconId(
  space: { metadata?: { icon?: unknown } | null } | null | undefined
): string | null {
  const icon = space?.metadata?.icon;
  return typeof icon === 'string' && SPACE_ICONS[icon] ? icon : null;
}
