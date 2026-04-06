// 🎯 PHASE 4 — Form Filler Workflow
// Universal form filling with verification

export interface FormField {
  label: string;
  value: string;
  type?: 'text' | 'email' | 'phone' | 'select' | 'checkbox' | 'textarea';
}

export interface FormFillerConfig {
  fields: FormField[];
  submitAfterFill?: boolean;
  verifyBeforeSubmit?: boolean;
}

export interface FormFillerResult {
  success: boolean;
  filledFields: string[];
  failedFields: string[];
  submitted: boolean;
  error?: string;
}

export function buildFormFillerTask(config: FormFillerConfig): string {
  const fieldList = config.fields
    .map((f) => `- "${f.label}": "${f.value}"`)
    .join('\n');

  let task = `Fill out the form on this page with the following information:\n\n${fieldList}\n\n`;

  task += `Instructions:\n`;
  task += `1. Find each field by its label or placeholder text\n`;
  task += `2. Click the field to focus it\n`;
  task += `3. Type the value (clear existing content first if needed)\n`;
  task += `4. Move to the next field\n`;

  if (config.verifyBeforeSubmit) {
    task += `5. After filling all fields, verify each value is correct\n`;
  }

  if (config.submitAfterFill) {
    task += `6. Click the submit/save button to complete the form\n`;
    task += `7. Wait for confirmation that the form was submitted successfully\n`;
  } else {
    task += `5. Do NOT submit the form - just fill in the fields\n`;
  }

  return task;
}

export function buildFormFillerPromptAddition(config: FormFillerConfig): string {
  return `
## FORM FILLING MODE

You are filling a form. Here are the exact values to use:

${config.fields.map((f) => `**${f.label}**: ${f.value}`).join('\n')}

### Rules for form filling:
1. Match fields by label text, placeholder, or aria-label
2. If a field has existing content, clear it first (Ctrl+A then type)
3. For dropdowns/selects, click to open, then click the matching option
4. For checkboxes, click to toggle (check current state first)
5. Tab or click to move between fields
6. After each field, verify the value was entered correctly

### Verification:
- After filling each field, confirm the value appears in the input
- If a field doesn't accept input, report which field failed
- ${config.submitAfterFill ? 'Submit only after ALL fields are verified' : 'Do NOT click submit'}
`;
}

// Common form presets
export const FORM_PRESETS = {
  contactForm: (data: { name: string; email: string; message: string }): FormFillerConfig => ({
    fields: [
      { label: 'Name', value: data.name, type: 'text' },
      { label: 'Email', value: data.email, type: 'email' },
      { label: 'Message', value: data.message, type: 'textarea' },
    ],
    submitAfterFill: false,
    verifyBeforeSubmit: true,
  }),

  loginForm: (data: { email: string; password: string }): FormFillerConfig => ({
    fields: [
      { label: 'Email', value: data.email, type: 'email' },
      { label: 'Password', value: data.password, type: 'text' },
    ],
    submitAfterFill: true,
    verifyBeforeSubmit: false,
  }),

  signupForm: (data: {
    name: string;
    email: string;
    password: string;
    confirmPassword?: string;
  }): FormFillerConfig => ({
    fields: [
      { label: 'Name', value: data.name, type: 'text' },
      { label: 'Email', value: data.email, type: 'email' },
      { label: 'Password', value: data.password, type: 'text' },
      ...(data.confirmPassword
        ? [{ label: 'Confirm Password', value: data.confirmPassword, type: 'text' as const }]
        : []),
    ],
    submitAfterFill: false,
    verifyBeforeSubmit: true,
  }),

  shippingAddress: (data: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
  }): FormFillerConfig => ({
    fields: [
      { label: 'First Name', value: data.firstName, type: 'text' },
      { label: 'Last Name', value: data.lastName, type: 'text' },
      { label: 'Address', value: data.address, type: 'text' },
      { label: 'City', value: data.city, type: 'text' },
      { label: 'State', value: data.state, type: 'select' },
      { label: 'ZIP', value: data.zip, type: 'text' },
      ...(data.country ? [{ label: 'Country', value: data.country, type: 'select' as const }] : []),
    ],
    submitAfterFill: false,
    verifyBeforeSubmit: true,
  }),
};
