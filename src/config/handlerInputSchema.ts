export interface HandlerInputSchema {
  fields: string[];
  stringShorthand: boolean;
}

export const HANDLER_REQUIRED_INPUT: Record<string, HandlerInputSchema> = {
  http: { fields: ['url'], stringShorthand: true },
  webpage: { fields: ['url'], stringShorthand: false },
  file: { fields: ['path'], stringShorthand: false },
  shell: { fields: ['command'], stringShorthand: true },
  'css-selector': { fields: ['selectors'], stringShorthand: false },
  jsonpath: { fields: ['queries'], stringShorthand: false },
  regex: { fields: ['patterns'], stringShorthand: false },
  expr: { fields: ['expression'], stringShorthand: false },
  'notification-desktop': { fields: ['title'], stringShorthand: false },
  log: { fields: [], stringShorthand: false },
};
