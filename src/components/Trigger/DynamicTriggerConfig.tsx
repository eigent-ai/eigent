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

import { proxyFetchGet, proxyFetchPost, proxyFetchPut } from '@/api/http';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useTriggerConfigQuery } from '@/hooks/queries/useTriggerQueries';
import { cn } from '@/lib/utils';
import { TriggerType } from '@/types';
import {
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Save,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

// ============ Types ============

type SchemaProperty = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: any;
  enum?: string[];
  items?: {
    type?: string;
    $ref?: string;
    enum?: string[];
  };
  anyOf?: Array<{ type: string; minimum?: number; maximum?: number }>;
  // UI hints from schema
  'ui:widget'?: string;
  'ui:widget:type'?: string;
  'ui:label'?: string;
  'ui:notice'?: string;
  'ui:placeholder'?: string;
  'ui:options'?: Array<{ label: string; value: string }>;
  // Validation
  'ui:validation'?: 'regex' | 'email' | 'url' | 'number';
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  // API endpoints
  'api:GET'?: string;
  'api:POST'?: string;
  'api:PUT'?: string;
  // Config group for credentials
  config_group?: string;
  // Exclude from API payload
  exclude?: boolean;
  // Hide from UI
  hidden?: boolean;
};

type ValidationError = {
  field: string;
  message: string;
};

export type { SchemaProperty, ValidationError };

export type TriggerConfigSchema = {
  title?: string;
  description?: string;
  type: string;
  properties: Record<string, SchemaProperty>;
  required?: string[];
  $defs?: Record<string, any>;
};

type SavedConfig = {
  id: number;
  config_group: string;
  config_name: string;
  config_value: string;
};

type DynamicTriggerConfigProps = {
  triggerType: TriggerType;
  value: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
  disabled?: boolean;
  showSectionTitles?: boolean;
  onValidationChange?: (isValid: boolean, errors: ValidationError[]) => void;
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
  isRequired?: boolean;
  validationError?: string;
  apiError?: string;
  onValidate: (fieldKey: string, value: any) => string | null;
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
  isRequired,
  validationError,
  onValidate,
}) => {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [savedValue, setSavedValue] = useState<string | null>(null);

  const isSecret = schema['ui:widget:type'] === 'secret';
  const hasApiEndpoint = !!schema['api:POST'];
  const savedConfig = savedConfigs[fieldKey];
  const isSaved = !!savedConfig;

  useEffect(() => {
    if (isSaved && savedConfig) {
      // Store the actual saved value for the eye toggle
      setSavedValue(savedConfig.config_value);
      // Show masked value in the input
      setLocalValue('••••••••••••••••');
    } else if (value) {
      setLocalValue(value);
      setSavedValue(null);
    } else {
      setLocalValue('');
      setSavedValue(null);
    }
  }, [value, isSaved, savedConfig]);

  const handleSave = async () => {
    if (!localValue || localValue === '••••••••••••••••') {
      toast.error(t('triggers.dynamic.enter-value'));
      return;
    }

    // Validate before saving
    const error = onValidate(fieldKey, localValue);
    if (error) {
      toast.error(error);
      return;
    }

    setIsSaving(true);
    try {
      await onSaveConfig(fieldKey, localValue);
      setSavedValue(localValue);
      setLocalValue('••••••••••••••••');
      setShowSecret(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (newValue: string) => {
    if (hasApiEndpoint) {
      setLocalValue(newValue);
    } else {
      onChange(newValue || null);
    }
    // Trigger validation on change
    onValidate(fieldKey, newValue);
  };

  const handleToggleSecret = () => {
    setShowSecret(!showSecret);
    if (!showSecret && savedValue) {
      // When showing, display the actual saved value
      setLocalValue(savedValue);
    } else if (showSecret && isSaved) {
      // When hiding and saved, show mask
      setLocalValue('••••••••••••••••');
    }
  };

  const label = schema['ui:label']
    ? t(schema['ui:label'])
    : schema.title || fieldKey;
  const notice = schema['ui:notice']
    ? t(schema['ui:notice'])
    : schema.description;
  const placeholder = schema['ui:placeholder']
    ? t(schema['ui:placeholder'])
    : undefined;
  const showError = touched && validationError;

  return (
    <div className="space-y-2">
      <Label className="text-sm">
        {label}
        {isRequired && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={isSecret && !showSecret ? 'password' : 'text'}
            value={hasApiEndpoint ? localValue : value || ''}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(isSecret ? 'pr-10' : '')}
          />
          {isSecret && (
            <button
              type="button"
              onClick={handleToggleSecret}
              className="hover:text-icon-hover absolute right-3 top-1/2 -translate-y-1/2 text-icon-primary"
            >
              {showSecret ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
        {hasApiEndpoint && (
          <Button
            variant={isSaved ? 'outline' : 'primary'}
            size="sm"
            onClick={handleSave}
            disabled={disabled || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSaved ? (
              <>
                <Save className="mr-1 h-4 w-4" />
                {t('triggers.dynamic.update')}
              </>
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                {t('triggers.dynamic.add')}
              </>
            )}
          </Button>
        )}
      </div>
      {showError && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <CircleAlert className="h-3 w-3" />
          {validationError}
        </p>
      )}
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
  isRequired,
}) => {
  const { t } = useTranslation();
  const label = schema['ui:label']
    ? t(schema['ui:label'])
    : schema.title || fieldKey;
  const notice = schema['ui:notice'] ? t(schema['ui:notice']) : null;

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label className="text-sm">
          {label}
          {isRequired && <span className="ml-1 text-red-500">*</span>}
        </Label>
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
  isRequired,
  validationError,
  apiError,
  onValidate,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isLoading, _setIsLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const hasDynamicApi = !!schema['api:GET'];
  const options = hasDynamicApi
    ? dynamicOptions[fieldKey] || []
    : schema['ui:options'] || [];
  const selectedValues: string[] = value || schema.default || [];

  const label = schema['ui:label']
    ? t(schema['ui:label'])
    : schema.title || fieldKey;
  const notice = schema['ui:notice']
    ? t(schema['ui:notice'])
    : schema.description;
  const showError = (touched && validationError) || apiError;
  const errorMessage = touched && validationError ? validationError : apiError;

  const handleToggle = (optionValue: string) => {
    let newValues: string[];
    if (selectedValues.includes(optionValue)) {
      newValues = selectedValues.filter((v) => v !== optionValue);
    } else {
      newValues = [...selectedValues, optionValue];
    }
    const finalValue = newValues.length > 0 ? newValues : null;
    onChange(finalValue);
    onValidate(fieldKey, finalValue);
    setTouched(true);
  };

  const getDisplayLabel = () => {
    if (!selectedValues || selectedValues.length === 0) {
      return t('triggers.dynamic.select-options');
    }
    if (selectedValues.length === 1) {
      const opt = options.find((o) => o.value === selectedValues[0]);
      return opt?.label || selectedValues[0];
    }
    return `${selectedValues.length} ${t('triggers.dynamic.selected')}`;
  };

  // Check if this field requires credentials but they're not saved
  const requiresCredentials = hasDynamicApi && !credentialsSaved;

  return (
    <div className="space-y-2">
      <Label className="text-sm">
        {label}
        {isRequired && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled || requiresCredentials}
          className="w-full justify-between font-normal"
        >
          {requiresCredentials ? (
            <span className="text-text-label">
              {t('triggers.dynamic.save-credentials-first')}
            </span>
          ) : isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('triggers.dynamic.loading')}
            </span>
          ) : (
            <span>{getDisplayLabel()}</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput placeholder={t('triggers.dynamic.search')} />
            <CommandList>
              <CommandEmpty>{t('triggers.dynamic.no-options')}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleToggle(option.value)}
                  >
                    <div
                      className={cn(
                        'border-primary mr-2 flex h-4 w-4 items-center justify-center rounded-sm border',
                        selectedValues.includes(option.value)
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50'
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
      {showError && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <CircleAlert className="h-3 w-3" />
          {errorMessage}
        </p>
      )}
      {notice && <p className="text-xs text-text-label">{notice}</p>}

      {/* Selected badges */}
      {selectedValues.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selectedValues.map((val) => {
            const opt = options.find((o) => o.value === val);
            return (
              <Badge
                key={val}
                variant="secondary"
                className="hover:bg-destructive/20 cursor-pointer text-xs"
                onClick={() => handleToggle(val)}
              >
                {opt?.label || val}
                <X className="ml-1 h-3 w-3" />
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
  isRequired,
  validationError,
  onValidate,
}) => {
  const { t } = useTranslation();
  const [newValue, setNewValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);

  const values: string[] = value || [];
  const label = schema['ui:label']
    ? t(schema['ui:label'])
    : schema.title || fieldKey;
  const notice = schema['ui:notice']
    ? t(schema['ui:notice'])
    : schema.description;
  const placeholder = schema['ui:placeholder']
    ? t(schema['ui:placeholder'])
    : undefined;
  const showError = touched && validationError;

  // Validate individual item based on schema validation type
  const validateItem = (item: string): string | null => {
    if (schema['ui:validation'] === 'regex') {
      try {
        new RegExp(item);
      } catch (_e) {
        return t('triggers.dynamic.validation.invalid-regex');
      }
    }
    return null;
  };

  const handleAdd = () => {
    if (!newValue.trim()) return;

    // Validate the item before adding
    const error = validateItem(newValue.trim());
    if (error) {
      setItemError(error);
      return;
    }

    if (!values.includes(newValue.trim())) {
      const newValues = [...values, newValue.trim()];
      onChange(newValues);
      onValidate(fieldKey, newValues);
    }
    setNewValue('');
    setItemError(null);
    setTouched(true);
  };

  const handleRemove = (val: string) => {
    const newValues = values.filter((v) => v !== val);
    onChange(newValues.length > 0 ? newValues : null);
    onValidate(fieldKey, newValues.length > 0 ? newValues : null);
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm">
        {label}
        {isRequired && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
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
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {itemError && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <CircleAlert className="h-3 w-3" />
          {itemError}
        </p>
      )}
      {showError && !itemError && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <CircleAlert className="h-3 w-3" />
          {validationError}
        </p>
      )}
      {notice && <p className="text-xs text-text-label">{notice}</p>}

      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {values.map((val) => (
            <Badge
              key={val}
              variant="secondary"
              className="hover:bg-destructive/20 cursor-pointer text-xs"
              onClick={() => handleRemove(val)}
            >
              {val}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};

// Number Input Field (for numeric values with min/max constraints)
const NumberInputField: React.FC<FieldProps> = ({
  fieldKey,
  schema,
  value,
  onChange,
  disabled,
  isRequired,
  validationError,
  onValidate,
}) => {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);

  const label = schema['ui:label']
    ? t(schema['ui:label'])
    : schema.title || fieldKey;
  const notice = schema['ui:notice']
    ? t(schema['ui:notice'])
    : schema.description;
  const placeholder = schema['ui:placeholder']
    ? t(schema['ui:placeholder'])
    : undefined;
  const showError = touched && validationError;

  // Get min/max constraints from anyOf structure
  let min: number | undefined;
  let max: number | undefined;

  if (schema.anyOf) {
    const numberConstraint = schema.anyOf.find(
      (item) => item.type === 'integer' || item.type === 'number'
    );
    if (numberConstraint) {
      min = numberConstraint.minimum;
      max = numberConstraint.maximum;
    }
  }

  const handleChange = (newValue: string) => {
    if (newValue === '') {
      onChange(null);
      onValidate(fieldKey, null);
      return;
    }

    const numValue = parseInt(newValue, 10);
    if (!isNaN(numValue)) {
      // Clamp to min/max if provided
      let clampedValue = numValue;
      if (min !== undefined && numValue < min) {
        clampedValue = min;
      }
      if (max !== undefined && numValue > max) {
        clampedValue = max;
      }
      onChange(clampedValue);
      onValidate(fieldKey, clampedValue);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm">
        {label}
        {isRequired && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        max={max}
        className={showError ? 'border-red-500' : ''}
      />
      {showError && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <CircleAlert className="h-3 w-3" />
          {validationError}
        </p>
      )}
      {notice && <p className="text-xs text-text-label">{notice}</p>}
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
  onValidationChange,
}) => {
  const { t } = useTranslation();
  const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedConfig>>(
    {}
  );
  const [dynamicOptions, setDynamicOptions] = useState<
    Record<string, Array<{ label: string; value: string }>>
  >({});
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});

  // Fetch schema using query hook
  const {
    data: configData,
    isLoading: isLoadingSchema,
    error: schemaError,
  } = useTriggerConfigQuery(triggerType);
  const schema =
    (configData?.schema_ as TriggerConfigSchema | undefined) || null;

  // Show error toast if schema fetch fails
  useEffect(() => {
    if (schemaError) {
      console.error('Failed to fetch trigger config schema:', schemaError);
      toast.error(t('triggers.dynamic.failed-to-load-schema'));
    }
  }, [schemaError, t]);

  // Validate a field and return error message if invalid
  const validateField = useCallback(
    (fieldKey: string, fieldValue: any): string | null => {
      if (!schema) return null;

      const prop = schema.properties[fieldKey];
      if (!prop) return null;

      const isRequired = schema.required?.includes(fieldKey);
      const label = prop['ui:label']
        ? t(prop['ui:label'])
        : prop.title || fieldKey;

      // Check required
      if (isRequired) {
        if (
          fieldValue === null ||
          fieldValue === undefined ||
          fieldValue === ''
        ) {
          return t('triggers.dynamic.validation.required', { field: label });
        }
        if (Array.isArray(fieldValue) && fieldValue.length === 0) {
          return t('triggers.dynamic.validation.required', { field: label });
        }
      }

      // Skip further validation if empty and not required
      if (
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === ''
      ) {
        return null;
      }

      // Regex validation
      if (prop['ui:validation'] === 'regex' && typeof fieldValue === 'string') {
        try {
          new RegExp(fieldValue);
        } catch (_e) {
          return t('triggers.dynamic.validation.invalid-regex');
        }
      }

      // Email validation
      if (prop['ui:validation'] === 'email' && typeof fieldValue === 'string') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(fieldValue)) {
          return t('triggers.dynamic.validation.invalid-email');
        }
      }

      // URL validation
      if (prop['ui:validation'] === 'url' && typeof fieldValue === 'string') {
        try {
          new URL(fieldValue);
        } catch (_e) {
          return t('triggers.dynamic.validation.invalid-url');
        }
      }

      // Min/Max length
      if (
        prop.minLength &&
        typeof fieldValue === 'string' &&
        fieldValue.length < prop.minLength
      ) {
        return t('triggers.dynamic.validation.min-length', {
          min: prop.minLength,
        });
      }
      if (
        prop.maxLength &&
        typeof fieldValue === 'string' &&
        fieldValue.length > prop.maxLength
      ) {
        return t('triggers.dynamic.validation.max-length', {
          max: prop.maxLength,
        });
      }

      // Pattern validation
      if (prop.pattern && typeof fieldValue === 'string') {
        try {
          const regex = new RegExp(prop.pattern);
          if (!regex.test(fieldValue)) {
            return t('triggers.dynamic.validation.pattern-mismatch');
          }
        } catch (_e) {
          // Invalid pattern in schema, skip validation
        }
      }

      // Minimum/Maximum value validation (for number inputs)
      // Get constraints from anyOf structure
      let min: number | undefined;
      let max: number | undefined;

      if (prop.anyOf) {
        const numberConstraint = prop.anyOf.find(
          (item) => item.type === 'integer' || item.type === 'number'
        );
        if (numberConstraint) {
          min = numberConstraint.minimum;
          max = numberConstraint.maximum;
        }
      }

      if (typeof fieldValue === 'number') {
        if (min !== undefined && fieldValue < min) {
          return t('triggers.dynamic.validation.min-value', { min });
        }
        if (max !== undefined && fieldValue > max) {
          return t('triggers.dynamic.validation.max-value', { max });
        }
      }

      return null;
    },
    [schema, t]
  );

  // Validate field and update errors state
  const handleValidate = useCallback(
    (fieldKey: string, fieldValue: any): string | null => {
      const error = validateField(fieldKey, fieldValue);

      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        if (error) {
          newErrors[fieldKey] = error;
        } else {
          delete newErrors[fieldKey];
        }
        return newErrors;
      });

      return error;
    },
    [validateField]
  );

  // Validate all fields and notify parent
  const validateAll = useCallback((): ValidationError[] => {
    if (!schema) return [];

    const errors: ValidationError[] = [];
    const newValidationErrors: Record<string, string> = {};

    Object.entries(schema.properties).forEach(([key, prop]) => {
      // Skip credential fields that are saved via API
      if (prop.config_group && prop['api:POST'] && savedConfigs[key]) {
        return;
      }

      const error = validateField(key, value[key]);
      if (error) {
        errors.push({ field: key, message: error });
        newValidationErrors[key] = error;
      }
    });

    setValidationErrors(newValidationErrors);
    return errors;
  }, [schema, value, savedConfigs, validateField]);

  // Notify parent of validation status when errors change
  useEffect(() => {
    if (onValidationChange && schema) {
      const errors = validateAll();
      onValidationChange(errors.length === 0, errors);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, schema, savedConfigs]);

  // Initialize defaults when schema is loaded
  useEffect(() => {
    if (schema) {
      const defaults: Record<string, any> = {};
      Object.entries(schema.properties).forEach(([key, prop]) => {
        if (prop.default !== undefined && value[key] === undefined) {
          defaults[key] = prop.default;
        }
      });
      if (Object.keys(defaults).length > 0) {
        onChange({ ...value, ...defaults });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  const fetchSavedConfigs = useCallback(async (configGroup: string) => {
    try {
      const response = await proxyFetchGet('/api/configs', {
        config_group: configGroup,
      });
      if (response && Array.isArray(response)) {
        const configs: Record<string, SavedConfig> = {};
        response.forEach((config: SavedConfig) => {
          configs[config.config_name] = config;
        });
        setSavedConfigs((prev) => ({ ...prev, ...configs }));
      }
    } catch (error) {
      console.error('Failed to fetch saved configs:', error);
    }
  }, []);

  const fetchDynamicOptions = useCallback(
    async (fieldKey: string, apiPath: string) => {
      try {
        // Clear previous error
        setApiErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[fieldKey];
          return newErrors;
        });
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
        } else if (response?.detail) {
          setApiErrors((prev) => ({ ...prev, [fieldKey]: response.detail }));
        }
      } catch (error) {
        console.error(`Failed to fetch options for ${fieldKey}:`, error);
      }
    },
    []
  );

  const hasAllCredentialsSaved = useCallback((): boolean => {
    if (!schema) return false;

    const credentialFields = Object.entries(schema.properties)
      .filter(([_, prop]) => prop.config_group && prop['api:POST'])
      .map(([key]) => key);

    return credentialFields.every((key) => savedConfigs[key]);
  }, [schema, savedConfigs]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  // Fetch dynamic options when credentials are saved
  useEffect(() => {
    if (!schema || !hasAllCredentialsSaved()) return;

    Object.entries(schema.properties).forEach(([key, prop]) => {
      if (prop['api:GET'] && !prop.config_group) {
        fetchDynamicOptions(key, prop['api:GET']);
      }
    });
  }, [schema, savedConfigs, hasAllCredentialsSaved, fetchDynamicOptions]);

  const handleSaveConfig = async (key: string, configValue: string) => {
    const prop = schema?.properties[key];
    if (!prop) return;

    const configGroup = prop.config_group || 'default';
    const existingConfig = savedConfigs[key];

    try {
      if (existingConfig) {
        await proxyFetchPut(`/api/configs/${existingConfig.id}`, {
          config_group: configGroup,
          config_name: key,
          config_value: configValue,
        });
        toast.success(t('triggers.dynamic.config-updated'));
      } else {
        const response = await proxyFetchPost('/api/configs', {
          config_group: configGroup,
          config_name: key,
          config_value: configValue,
        });
        setSavedConfigs((prev) => ({ ...prev, [key]: response }));
        toast.success(t('triggers.dynamic.config-saved'));
      }
      // Refetch configs
      fetchSavedConfigs(configGroup);
    } catch (error) {
      console.error('Failed to save config:', error);
      toast.error(t('triggers.dynamic.config-save-error'));
      throw error;
    }
  };

  const handleFieldChange = (fieldKey: string, fieldValue: any) => {
    onChange({ ...value, [fieldKey]: fieldValue });
  };

  const renderField = (fieldKey: string, prop: SchemaProperty) => {
    const widget = prop['ui:widget'];
    const isRequired = schema?.required?.includes(fieldKey) ?? false;
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
      isRequired,
      validationError: validationErrors[fieldKey],
      apiError: apiErrors[fieldKey],
      onValidate: handleValidate,
    };

    switch (widget) {
      case 'switch':
        return <SwitchField key={fieldKey} {...fieldProps} />;
      case 'multi-select':
        return <MultiSelectField key={fieldKey} {...fieldProps} />;
      case 'multi-text-input':
        return <MultiTextInputField key={fieldKey} {...fieldProps} />;
      case 'number-input':
        return <NumberInputField key={fieldKey} {...fieldProps} />;
      case 'text-input':
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
      // Skip hidden fields from UI rendering
      if (prop.hidden === true) {
        return;
      }
      if (prop.config_group && prop['api:POST']) {
        credentials.push([key, prop]);
      } else if (prop['ui:widget'] === 'switch') {
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
        <Loader2 className="h-6 w-6 animate-spin text-text-label" />
        <span className="ml-2 text-text-label">
          {t('triggers.dynamic.loading-config')}
        </span>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="py-8 text-center text-text-label">
        {t('triggers.dynamic.no-config-available')}
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
              <Label className="text-sm font-bold text-text-heading">
                {t('triggers.dynamic.credentials')}
              </Label>
              <TooltipSimple content={t('triggers.dynamic.credentials-notice')}>
                <CircleAlert className="h-4 w-4 cursor-pointer text-icon-primary" />
              </TooltipSimple>
            </div>
          )}
          {credentials.map(([key, prop]) => renderField(key, prop))}

          {hasAllCredentialsSaved() && (
            <div className="bg-surface-success/20 flex items-center gap-2 rounded-lg p-2">
              <Check className="h-4 w-4 text-text-success" />
              <span className="text-sm text-text-success">
                {t('triggers.dynamic.credentials-saved')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Configuration Section */}
      {config.length > 0 && (
        <div className="space-y-4 border-t border-border-secondary pt-4">
          {showSectionTitles && (
            <Label className="text-sm font-bold text-text-heading">
              {t('triggers.dynamic.configuration')}
            </Label>
          )}
          {config.map(([key, prop]) => renderField(key, prop))}
        </div>
      )}

      {/* Behavior Settings Section */}
      {behavior.length > 0 && (
        <div className="space-y-4 border-t border-border-secondary pt-4">
          {showSectionTitles && (
            <Label className="text-sm font-bold text-text-heading">
              {t('triggers.dynamic.behavior-settings')}
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

// Helper to filter out fields marked with exclude: true from config based on schema
export const filterExcludedFields = (
  config: Record<string, any>,
  schema: TriggerConfigSchema | null
): Record<string, any> => {
  if (!schema?.properties) return config;

  const filteredConfig = { ...config };
  Object.entries(schema.properties).forEach(([key, prop]) => {
    if (prop.exclude === true) {
      delete filteredConfig[key];
    }
  });
  return filteredConfig;
};

export default DynamicTriggerConfig;
