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

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MCPUserItem } from './types';

interface MCPListItemProps {
  item: MCPUserItem;
  onSetting: (item: MCPUserItem) => void;
  onDelete: (item: MCPUserItem) => void;
  onSwitch: (id: number, checked: boolean) => Promise<void>;
  loading: boolean;
}

export default function MCPListItem({
  item,
  onSetting: _onSetting,
  onDelete,
  onSwitch: _onSwitch,
  loading: _loading,
}: MCPListItemProps) {
  const [_showMenu, setShowMenu] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl bg-surface-tertiary p-4">
      <div className="flex items-center gap-xs">
        <div className="mx-xs h-3 w-3 rounded-full bg-green-500"></div>
        <div className="text-base font-bold leading-9 text-text-primary">
          {item.mcp_name}
        </div>
        <div className="flex items-center">
          <TooltipSimple content={item.mcp_desc}>
            <CircleAlert className="h-4 w-4 text-icon-secondary" />
          </TooltipSimple>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* <Switch
					checked={item.status === 1}
					disabled={loading}
					onCheckedChange={(checked) => onSwitch(item.id, checked)}
				/> */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => {
            onDelete(item);
            setShowMenu(false);
          }}
        >
          <Trash2 className="h-4 w-4" /> {t('setting.delete')}
        </Button>
        {/* <div className="relative">
					<Popover>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setShowMenu((v) => !v)}
								disabled={loading}
							>
								<Ellipsis className="w-4 h-4 text-icon-primary" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[98px] p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border">
							<div className="space-y-1">
								<PopoverClose asChild>
									<Button
										variant="ghost"
										size="sm"
										className="w-full"
										onClick={() => {
                      onSetting(item);
                      setShowMenu(false);
                    }}
									>
										<Settings className="w-4 h-4" /> {t("setting.setting")}
									</Button>
								</PopoverClose>
								<PopoverClose asChild>
									<Button
										variant="ghost"
										size="sm"
										className="w-full !text-text-cuation"
										onClick={() => {
											onDelete(item);
											setShowMenu(false);
										}}
									>
										<Trash2 className="w-4 h-4" /> {t("setting.delete")}
									</Button>
								</PopoverClose>
							</div>
						</PopoverContent>
					</Popover>
				</div> */}
      </div>
    </div>
  );
}
