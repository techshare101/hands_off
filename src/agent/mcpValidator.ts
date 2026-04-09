// ═══════════════════════════════════════════════════════════════════════════
// MCP Schema Validator — Runtime validation for MCP tool calls
// Prevents malformed arguments from crashing the agent or failing silently.
// ═══════════════════════════════════════════════════════════════════════════

// ── Validation Result ────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  normalizedArgs: Record<string, unknown>;
}

// ── Schema Types (subset of JSON Schema) ─────────────────────────────────

interface JSONSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'email' | 'uri' | 'date' | 'date-time';
  description?: string;
  default?: unknown;
  additionalProperties?: boolean;
}

// ── Validator Engine ─────────────────────────────────────────────────────

class MCPValidatorEngine {
  // Validate tool arguments against their input schema
  validate(args: Record<string, unknown>, schema: JSONSchema): ValidationResult {
    const errors: string[] = [];
    const normalizedArgs: Record<string, unknown> = { ...args };

    // Object-level validation
    if (schema.type === 'object') {
      // Check required fields
      if (schema.required) {
        for (const req of schema.required) {
          if (!(req in args) || args[req] === undefined || args[req] === null) {
            errors.push(`Missing required field: ${req}`);
          }
        }
      }

      // Validate each property
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in args) {
            const propResult = this.validateValue(args[key], propSchema, key);
            if (!propResult.valid) {
              errors.push(...propResult.errors);
            }
          }
        }
      }

      // Check for extra properties
      if (schema.additionalProperties === false) {
        const allowedKeys = Object.keys(schema.properties || {});
        for (const key of Object.keys(args)) {
          if (!allowedKeys.includes(key)) {
            errors.push(`Unexpected field: ${key}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      normalizedArgs,
    };
  }

  // Validate a single value against a schema
  private validateValue(value: unknown, schema: JSONSchema, path: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Type checking
    if (schema.type) {
      const actualType = this.getType(value);
      if (!this.isTypeMatch(actualType, schema.type)) {
        errors.push(`${path}: expected ${schema.type}, got ${actualType}`);
        return { valid: false, errors };
      }
    }

    // String validations
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: minimum length is ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: maximum length is ${schema.maxLength}`);
      }
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push(`${path}: does not match pattern ${schema.pattern}`);
        }
      }
      if (schema.format) {
        const formatValid = this.validateFormat(value, schema.format);
        if (!formatValid) {
          errors.push(`${path}: invalid ${schema.format} format`);
        }
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
      }
    }

    // Number validations
    if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${path}: must be an integer`);
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: minimum value is ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: maximum value is ${schema.maximum}`);
      }
    }

    // Array validations
    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const itemResult = this.validateValue(value[i], schema.items, `${path}[${i}]`);
          if (!itemResult.valid) {
            errors.push(...itemResult.errors);
          }
        }
      }
    }

    // Object validations (recursive)
    if (schema.type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const objResult = this.validate(value as Record<string, unknown>, schema);
      if (!objResult.valid) {
        errors.push(...objResult.errors.map(e => `${path}.${e}`));
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Get JavaScript type of a value
  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  // Check if actual type matches expected schema type
  private isTypeMatch(actual: string, expected: string): boolean {
    if (actual === expected) return true;
    // Allow number to match integer if it's whole
    if (expected === 'integer' && actual === 'number') return true;
    // Allow flexible typing for common cases
    if (expected === 'object' && (actual === 'array' || actual === 'null')) return false;
    return actual === expected;
  }

  // Validate string formats
  private validateFormat(value: string, format: string): boolean {
    switch (format) {
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      case 'uri':
        return /^https?:\/\/.+/.test(value);
      case 'date':
        return /^\d{4}-\d{2}-\d{2}$/.test(value);
      case 'date-time':
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
      default:
        return true;
    }
  }

  // Sanitize and normalize args based on schema defaults
  sanitize(args: Record<string, unknown>, schema: JSONSchema): Record<string, unknown> {
    if (schema.type !== 'object' || !schema.properties) {
      return args;
    }

    const result: Record<string, unknown> = { ...args };

    // Apply defaults for missing fields
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in result) && propSchema.default !== undefined) {
        result[key] = propSchema.default;
      }
    }

    // Remove undefined values
    for (const key of Object.keys(result)) {
      if (result[key] === undefined) {
        delete result[key];
      }
    }

    return result;
  }

  // Quick check if args look valid (for decision routing)
  isLikelyValid(args: Record<string, unknown>, schema: JSONSchema): boolean {
    // Fast path: check required fields exist
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in args)) return false;
      }
    }
    return true;
  }
}

// Singleton
export const mcpValidator = new MCPValidatorEngine();

// ── Convenience Export ────────────────────────────────────────────────────

export function validateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  schema: Record<string, unknown>
): ValidationResult {
  const result = mcpValidator.validate(args, schema as JSONSchema);
  if (!result.valid) {
    console.warn(`[MCPValidator] Tool "${toolName}" validation failed:`, result.errors);
  }
  return result;
}

export function sanitizeToolArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>
): Record<string, unknown> {
  return mcpValidator.sanitize(args, schema as JSONSchema);
}
