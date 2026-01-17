import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { TooltipSimple } from "@/components/ui/tooltip";
import {
    Check,
    ChevronDown,
    Plus,
    Save,
    Eye,
    EyeOff,
    CircleAlert,
    X,
    Loader2,
    Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { proxyFetchGet, proxyFetchPost, proxyFetchPut } from "@/api/http";
import { TriggerType } from "@/types";

// ============ Types ============

type SchemaProperty = {
    type?: string | string[];
    title?: string;
    description?: string;
    default?: any;
    enum?: string[];
    items?: {
        type?: string;
        "$ref"?: string;
    };
    anyOf?: Array<{ type: string }>;
    // UI hints from schema
    "ui:widget"?: string;
    "ui:widget:type"?: string;
    "ui:label"?: string;
    "ui:notice"?: string;
    "ui:placeholder"?: string;
    "ui:options"?: Array<{ label: string; value: string }>;
    // API endpoints
    "api:GET"?: string;
    "api:POST"?: string;
    "api:PUT"?: string;
    // Config group for credentials
    config_group?: string;
};

type TriggerConfigSchema = {
    title?: string;
    description?: string;
    type: string;
    properties: Record<string, SchemaProperty>;
    required?: string[];
    "$defs"?: Record<string, any>;
};

type SavedConfig = {
    id: number;
    config_group: string;
    key: string;
    value: string;
};

type DynamicTriggerConfigProps = {
    triggerType: TriggerType;
    value: Record<string, any>;
    onChange: (config: Record<string, any>) => void;
    disabled?: boolean;
    showSectionTitles?: boolean;
};

// ============ Field Components ============

type FieldProps = {
    fieldKey: string;
    schema: SchemaProperty;
    value: any;
    onChange: (value: any) => void;
    disabled?: boolean;
    savedConfigs: Record<string, SavedConfig>;
    onSaveConfig: (key: string, value: string) => Promise<void>;
    dynamicOptions: Record<string, Array<{ label: string; value: string }>>;
    credentialsSaved: boolean;
};

// Text Input Field (including secrets)
const TextInputField: React.FC<FieldProps> = ({
    fieldKey,
    schema,
    value,
    onChange,
    disabled,
    savedConfigs,
    onSaveConfig,
}) => {
    const { t } = useTranslation();
    const [localValue, setLocalValue] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const isSecret = schema["ui:widget:type"] === "secret";
    const hasApiEndpoint = !!schema["api:POST"];
    const savedConfig = savedConfigs[fieldKey];
    const isSaved = !!savedConfig;

    useEffect(() => {
        if (isSaved) {
            setLocalValue("••••••••••••••••");
        } else if (value) {
            setLocalValue(value);
        }
    }, [value, isSaved]);

    const handleSave = async () => {
        if (!localValue || localValue === "••••••••••••••••") {
            toast.error(t("triggers.dynamic.enter-value"));
            return;
        }
        setIsSaving(true);
        try {
            await onSaveConfig(fieldKey, localValue);
            setLocalValue("••••••••••••••••");
            setShowSecret(false);
        } finally {
            setIsSaving(false);
        }
    };

    const label = schema["ui:label"] ? t(schema["ui:label"]) : (schema.title || fieldKey);
    const notice = schema["ui:notice"] ? t(schema["ui:notice"]) : schema.description;
    const placeholder = schema["ui:placeholder"] ? t(schema["ui:placeholder"]) : undefined;

    return (
        <div className="space-y-2">
            <Label className="text-sm">{label}</Label>
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input
                        type={isSecret && !showSecret ? "password" : "text"}
                        value={hasApiEndpoint ? localValue : (value || "")}
                        onChange={(e) => {
                            if (hasApiEndpoint) {
                                setLocalValue(e.target.value);
                            } else {
                                onChange(e.target.value || null);
                            }
                        }}
                        placeholder={placeholder}
                        disabled={disabled}
                        className={isSecret ? "pr-10" : ""}
                    />
                    {isSecret && (
                        <button
                            type="button"
                            onClick={() => setShowSecret(!showSecret)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-icon-primary hover:text-icon-hover"
                        >
                            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    )}
                </div>
                {hasApiEndpoint && (
                    <Button
                        variant={isSaved ? "outline" : "primary"}
                        size="sm"
                        onClick={handleSave}
                        disabled={disabled || isSaving}
                    >
                        {isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isSaved ? (
                            <>
                                <Save className="w-4 h-4 mr-1" />
                                {t("triggers.dynamic.update")}
                            </>
                        ) : (
                            <>
                                <Plus className="w-4 h-4 mr-1" />
                                {t("triggers.dynamic.add")}
                            </>
                        )}
                    </Button>
                )}
            </div>
            {notice && <p className="text-xs text-text-label">{notice}</p>}
        </div>
    );
};

// Switch Field
const SwitchField: React.FC<FieldProps> = ({
    fieldKey,
    schema,
    value,
    onChange,
    disabled,
}) => {
    const { t } = useTranslation();
    const label = schema["ui:label"] ? t(schema["ui:label"]) : (schema.title || fieldKey);
    const notice = schema["ui:notice"] ? t(schema["ui:notice"]) : null;

    return (
        <div className="flex items-center justify-between">
            <div className="space-y-0.5">
                <Label className="text-sm">{label}</Label>
                {notice && <p className="text-xs text-text-label">{notice}</p>}
            </div>
            <Switch
                size="sm"
                checked={value ?? schema.default ?? false}
                onCheckedChange={onChange}
                disabled={disabled}
            />
        </div>
    );
};

// Multi-Select Field
const MultiSelectField: React.FC<FieldProps> = ({
    fieldKey,
    schema,
    value,
    onChange,
    disabled,
    dynamicOptions,
    credentialsSaved,
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const hasDynamicApi = !!schema["api:GET"];
    const options = hasDynamicApi ? (dynamicOptions[fieldKey] || []) : (schema["ui:options"] || []);
    const selectedValues: string[] = value || schema.default || [];

    const label = schema["ui:label"] ? t(schema["ui:label"]) : (schema.title || fieldKey);
    const notice = schema["ui:notice"] ? t(schema["ui:notice"]) : schema.description;

    const handleToggle = (optionValue: string) => {
        let newValues: string[];
        if (selectedValues.includes(optionValue)) {
            newValues = selectedValues.filter((v) => v !== optionValue);
        } else {
            newValues = [...selectedValues, optionValue];
        }
        onChange(newValues.length > 0 ? newValues : null);
    };

    const getDisplayLabel = () => {
        if (!selectedValues || selectedValues.length === 0) {
            return t("triggers.dynamic.select-options");
        }
        if (selectedValues.length === 1) {
            const opt = options.find((o) => o.value === selectedValues[0]);
            return opt?.label || selectedValues[0];
        }
        return `${selectedValues.length} ${t("triggers.dynamic.selected")}`;
    };

    // Check if this field requires credentials but they're not saved
    const requiresCredentials = hasDynamicApi && !credentialsSaved;

    return (
        <div className="space-y-2">
            <Label className="text-sm">{label}</Label>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-full justify-between font-normal"
                        disabled={disabled || requiresCredentials}
                    >
                        {requiresCredentials ? (
                            <span className="text-text-label">
                                {t("triggers.dynamic.save-credentials-first")}
                            </span>
                        ) : isLoading ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t("triggers.dynamic.loading")}
                            </span>
                        ) : (
                            getDisplayLabel()
                        )}
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                    <Command>
                        <CommandInput placeholder={t("triggers.dynamic.search")} />
                        <CommandList>
                            <CommandEmpty>{t("triggers.dynamic.no-options")}</CommandEmpty>
                            <CommandGroup>
                                {options.map((option) => (
                                    <CommandItem
                                        key={option.value}
                                        value={option.value}
                                        onSelect={() => handleToggle(option.value)}
                                    >
                                        <div
                                            className={cn(
                                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                selectedValues.includes(option.value)
                                                    ? "bg-primary text-primary-foreground"
                                                    : "opacity-50"
                                            )}
                                        >
                                            {selectedValues.includes(option.value) && (
                                                <Check className="h-3 w-3" />
                                            )}
                                        </div>
                                        {option.label}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {notice && <p className="text-xs text-text-label">{notice}</p>}
            
            {/* Selected badges */}
            {selectedValues.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {selectedValues.map((val) => {
                        const opt = options.find((o) => o.value === val);
                        return (
                            <Badge
                                key={val}
                                variant="secondary"
                                className="text-xs cursor-pointer hover:bg-destructive/20"
                                onClick={() => handleToggle(val)}
                            >
                                {opt?.label || val}
                                <X className="w-3 h-3 ml-1" />
                            </Badge>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// Multi-Text Input Field (for arrays of strings like ignore_users)
const MultiTextInputField: React.FC<FieldProps> = ({
    fieldKey,
    schema,
    value,
    onChange,
    disabled,
}) => {
    const { t } = useTranslation();
    const [newValue, setNewValue] = useState("");

    const values: string[] = value || [];
    const label = schema["ui:label"] ? t(schema["ui:label"]) : schema.title || fieldKey;
    const notice = schema["ui:notice"] ? t(schema["ui:notice"]) : schema.description;
    const placeholder = schema["ui:placeholder"] ? t(schema["ui:placeholder"]) : undefined;

    const handleAdd = () => {
        if (!newValue.trim()) return;
        if (!values.includes(newValue.trim())) {
            onChange([...values, newValue.trim()]);
        }
        setNewValue("");
    };

    const handleRemove = (val: string) => {
        onChange(values.filter((v) => v !== val));
    };

    return (
        <div className="space-y-2">
            <Label className="text-sm">{label}</Label>
            <div className="flex gap-2">
                <Input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            handleAdd();
                        }
                    }}
                />
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAdd}
                    disabled={disabled || !newValue.trim()}
                >
                    <Plus className="w-4 h-4" />
                </Button>
            </div>
            {notice && <p className="text-xs text-text-label">{notice}</p>}
            
            {values.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {values.map((val) => (
                        <Badge
                            key={val}
                            variant="secondary"
                            className="text-xs cursor-pointer hover:bg-destructive/20"
                            onClick={() => handleRemove(val)}
                        >
                            {val}
                            <X className="w-3 h-3 ml-1" />
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
};

// ============ Main Component ============

export const DynamicTriggerConfig: React.FC<DynamicTriggerConfigProps> = ({
    triggerType,
    value,
    onChange,
    disabled = false,
    showSectionTitles = true,
}) => {
    const { t } = useTranslation();
    const [schema, setSchema] = useState<TriggerConfigSchema | null>(null);
    const [isLoadingSchema, setIsLoadingSchema] = useState(true);
    const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedConfig>>({});
    const [dynamicOptions, setDynamicOptions] = useState<Record<string, Array<{ label: string; value: string }>>>({});

    // Fetch schema on mount or trigger type change
    useEffect(() => {
        const fetchSchema = async () => {
            setIsLoadingSchema(true);
            try {
                const response = await proxyFetchGet(`/api/trigger/${triggerType}/config`);
                if (response?.schema_) {
                    setSchema(response.schema_);
                    // Initialize default values
                    initializeDefaults(response.schema_);
                }
            } catch (error) {
                console.error("Failed to fetch trigger config schema:", error);
                toast.error(t("triggers.dynamic.failed-to-load-schema"));
            } finally {
                setIsLoadingSchema(false);
            }
        };

        fetchSchema();
    }, [triggerType]);

    // Initialize defaults from schema
    const initializeDefaults = (schema: TriggerConfigSchema) => {
        const defaults: Record<string, any> = {};
        Object.entries(schema.properties).forEach(([key, prop]) => {
            if (prop.default !== undefined && value[key] === undefined) {
                defaults[key] = prop.default;
            }
        });
        if (Object.keys(defaults).length > 0) {
            onChange({ ...value, ...defaults });
        }
    };

    // Fetch saved configs for credential fields
    useEffect(() => {
        if (!schema) return;

        const configGroups = new Set<string>();
        Object.values(schema.properties).forEach((prop) => {
            if (prop.config_group) {
                configGroups.add(prop.config_group);
            }
        });

        configGroups.forEach((group) => {
            fetchSavedConfigs(group);
        });
    }, [schema]);

    // Fetch dynamic options when credentials are saved
    useEffect(() => {
        if (!schema || !hasAllCredentialsSaved()) return;

        Object.entries(schema.properties).forEach(([key, prop]) => {
            if (prop["api:GET"] && !prop.config_group) {
                fetchDynamicOptions(key, prop["api:GET"]);
            }
        });
    }, [schema, savedConfigs]);

    const fetchSavedConfigs = async (configGroup: string) => {
        try {
            const response = await proxyFetchGet("/api/configs", { config_group: configGroup });
            if (response && Array.isArray(response)) {
                const configs: Record<string, SavedConfig> = {};
                response.forEach((config: SavedConfig) => {
                    configs[config.key] = config;
                });
                setSavedConfigs((prev) => ({ ...prev, ...configs }));
            }
        } catch (error) {
            console.error("Failed to fetch saved configs:", error);
        }
    };

    const fetchDynamicOptions = async (fieldKey: string, apiPath: string) => {
        try {
            const response = await proxyFetchGet(`/api/${apiPath}`);
            if (response && Array.isArray(response)) {
                // Transform response to options format
                const options = response.map((item: any) => ({
                    label: item.name || item.label || item.id,
                    value: item.id || item.value,
                }));
                setDynamicOptions((prev) => ({ ...prev, [fieldKey]: options }));
            } else if (response?.channels) {
                const options = response.channels.map((item: any) => ({
                    label: `#${item.name}`,
                    value: item.id,
                }));
                setDynamicOptions((prev) => ({ ...prev, [fieldKey]: options }));
            }
        } catch (error) {
            console.error(`Failed to fetch options for ${fieldKey}:`, error);
        }
    };

    const handleSaveConfig = async (key: string, configValue: string) => {
        const prop = schema?.properties[key];
        if (!prop) return;

        const configGroup = prop.config_group || "default";
        const existingConfig = savedConfigs[key];

        try {
            if (existingConfig) {
                await proxyFetchPut(`/api/configs/${existingConfig.id}`, { value: configValue });
                toast.success(t("triggers.dynamic.config-updated"));
            } else {
                const response = await proxyFetchPost("/api/configs", {
                    config_group: configGroup,
                    key: key,
                    value: configValue,
                });
                setSavedConfigs((prev) => ({ ...prev, [key]: response }));
                toast.success(t("triggers.dynamic.config-saved"));
            }
            // Refetch configs
            fetchSavedConfigs(configGroup);
        } catch (error) {
            console.error("Failed to save config:", error);
            toast.error(t("triggers.dynamic.config-save-error"));
            throw error;
        }
    };

    const hasAllCredentialsSaved = (): boolean => {
        if (!schema) return false;
        
        const credentialFields = Object.entries(schema.properties)
            .filter(([_, prop]) => prop.config_group && prop["api:POST"])
            .map(([key]) => key);
        
        return credentialFields.every((key) => savedConfigs[key]);
    };

    const handleFieldChange = (fieldKey: string, fieldValue: any) => {
        onChange({ ...value, [fieldKey]: fieldValue });
    };

    const renderField = (fieldKey: string, prop: SchemaProperty) => {
        const widget = prop["ui:widget"];
        const fieldProps: FieldProps = {
            fieldKey,
            schema: prop,
            value: value[fieldKey],
            onChange: (v) => handleFieldChange(fieldKey, v),
            disabled,
            savedConfigs,
            onSaveConfig: handleSaveConfig,
            dynamicOptions,
            credentialsSaved: hasAllCredentialsSaved(),
        };

        switch (widget) {
            case "switch":
                return <SwitchField key={fieldKey} {...fieldProps} />;
            case "multi-select":
                return <MultiSelectField key={fieldKey} {...fieldProps} />;
            case "multi-text-input":
                return <MultiTextInputField key={fieldKey} {...fieldProps} />;
            case "text-input":
            default:
                return <TextInputField key={fieldKey} {...fieldProps} />;
        }
    };

    // Group fields by their purpose
    const groupFields = () => {
        if (!schema) return { credentials: [], config: [], behavior: [] };

        const credentials: [string, SchemaProperty][] = [];
        const config: [string, SchemaProperty][] = [];
        const behavior: [string, SchemaProperty][] = [];

        Object.entries(schema.properties).forEach(([key, prop]) => {
            if (prop.config_group && prop["api:POST"]) {
                credentials.push([key, prop]);
            } else if (prop["ui:widget"] === "switch") {
                behavior.push([key, prop]);
            } else {
                config.push([key, prop]);
            }
        });

        return { credentials, config, behavior };
    };

    if (isLoadingSchema) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-text-label" />
                <span className="ml-2 text-text-label">{t("triggers.dynamic.loading-config")}</span>
            </div>
        );
    }

    if (!schema) {
        return (
            <div className="text-center py-8 text-text-label">
                {t("triggers.dynamic.no-config-available")}
            </div>
        );
    }

    const { credentials, config, behavior } = groupFields();

    return (
        <div className="space-y-6">
            {/* Credentials Section */}
            {credentials.length > 0 && (
                <div className="space-y-4">
                    {showSectionTitles && (
                        <div className="flex items-center gap-2">
                            <Label className="font-bold text-sm text-text-heading">
                                {t("triggers.dynamic.credentials")}
                            </Label>
                            <TooltipSimple content={t("triggers.dynamic.credentials-notice")}>
                                <CircleAlert className="w-4 h-4 text-icon-primary cursor-pointer" />
                            </TooltipSimple>
                        </div>
                    )}
                    {credentials.map(([key, prop]) => renderField(key, prop))}
                    
                    {hasAllCredentialsSaved() && (
                        <div className="flex items-center gap-2 p-2 bg-surface-success/20 rounded-lg">
                            <Check className="w-4 h-4 text-text-success" />
                            <span className="text-sm text-text-success">
                                {t("triggers.dynamic.credentials-saved")}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Configuration Section */}
            {config.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-border-secondary">
                    {showSectionTitles && (
                        <Label className="font-bold text-sm text-text-heading">
                            {t("triggers.dynamic.configuration")}
                        </Label>
                    )}
                    {config.map(([key, prop]) => renderField(key, prop))}
                </div>
            )}

            {/* Behavior Settings Section */}
            {behavior.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-border-secondary">
                    {showSectionTitles && (
                        <Label className="font-bold text-sm text-text-heading">
                            {t("triggers.dynamic.behavior-settings")}
                        </Label>
                    )}
                    {behavior.map(([key, prop]) => renderField(key, prop))}
                </div>
            )}
        </div>
    );
};

// Helper to get default config based on trigger type
export const getDefaultTriggerConfig = (): Record<string, any> => ({});

export default DynamicTriggerConfig;
