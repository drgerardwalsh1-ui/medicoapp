export type Option = {
  label: string;          // shown to user (ccText)
  value: any;             // numeric/system value
  backgroundValue?: any;  // VBA equivalent
};

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select";

export type FieldSchema = {
  key: string;
  label: string;
  type?: FieldType;
  options?: Option[];
  section?: string;
};