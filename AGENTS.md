# Project interface guidelines

## Show data first; edit after an explicit action

Apply this default to every new or modified interface in this project:

- Start with a readable view of the saved data: summaries, values, status badges,
  charts, or other suitable visualizations. Do not use an always-open form or
  disabled form fields as the default presentation of existing settings.
- Open editing controls only after an explicit user action, such as clicking
  **Edit** or **Choose devices**. Use real buttons with clear labels and keyboard
  support.
- For forms, provide **Save** and **Cancel**. Keep changes in a draft until a
  successful save; cancellation discards the draft. Return to the updated data
  view after saving, and restore focus to the control that opened the editor.
- Keep errors and the user's draft visible if saving fails. Prevent duplicate
  submissions. Background refreshes must not overwrite an active draft, and
  drafts must not carry over when switching apartments or devices.
- Clearly distinguish disabled rules and missing data from active settings or
  zero values. Preserve English/Polish translations and mobile accessibility.

Use the device details/configuration view and notification rules summary/editor
as references. Navigation, filters, and date ranges may remain directly
interactive; they do not edit saved data. Explicit creation flows may open a
form immediately after the user chooses to add something.
