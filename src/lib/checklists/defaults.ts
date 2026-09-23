/** Checklist field types used in template JSON. */
export type ChecklistFieldType =
  | "checkbox"
  | "text"
  | "long_text"
  | "number"
  | "select"
  | "photo"
  | "signature"
  | "measurement_rooms";

export type ChecklistField = {
  id: string;
  label: string;
  type: ChecklistFieldType;
  options?: string[];
  required?: boolean;
};

export type DefaultChecklistTemplate = {
  name: string;
  appliesTo: "site_assessment" | "visit";
  visitPhase?: string | null;
  sortOrder: number;
  fields: ChecklistField[];
};

export const DEFAULT_CHECKLIST_TEMPLATES: DefaultChecklistTemplate[] = [
  {
    name: "Site measurement",
    appliesTo: "site_assessment",
    sortOrder: 1,
    fields: [
      { id: "rooms", label: "Rooms (name + area sqft)", type: "measurement_rooms", required: true },
      { id: "existing_flooring", label: "Existing flooring", type: "text", required: false },
      {
        id: "needs_removal",
        label: "Needs existing floor removal?",
        type: "select",
        options: ["yes", "no"],
        required: true,
      },
      {
        id: "subfloor_type",
        label: "Subfloor type",
        type: "select",
        options: ["concrete", "plywood", "osb", "other"],
        required: true,
      },
      { id: "moisture_reading", label: "Moisture reading", type: "number", required: false },
      { id: "needs_leveling", label: "Leveling needed?", type: "checkbox", required: false },
      { id: "stair_count", label: "Stair treads (count)", type: "number", required: false },
      { id: "baseboard_lf", label: "Baseboard (lf)", type: "number", required: false },
      { id: "move_furniture", label: "Furniture to move", type: "long_text", required: false },
      { id: "photos", label: "Photos", type: "photo", required: false },
      { id: "notes", label: "Notes", type: "long_text", required: false },
    ],
  },
  {
    name: "Pre-installation",
    appliesTo: "visit",
    visitPhase: "subfloor_prep",
    sortOrder: 2,
    fields: [
      { id: "moisture_ok", label: "Subfloor moisture OK", type: "checkbox", required: true },
      { id: "leveling_ok", label: "Leveling OK", type: "checkbox", required: true },
      { id: "acclimation_days", label: "Material acclimated (days)", type: "number", required: false },
      { id: "area_cleared", label: "Area cleared", type: "checkbox", required: true },
      { id: "photos", label: "Photos", type: "photo", required: false },
    ],
  },
  {
    name: "Installation daily log",
    appliesTo: "visit",
    visitPhase: "installation",
    sortOrder: 3,
    fields: [
      { id: "area_completed_sqft", label: "Area completed today (sqft)", type: "number", required: true },
      { id: "issues", label: "Problems / notes", type: "long_text", required: false },
      { id: "photos", label: "Photos", type: "photo", required: false },
    ],
  },
  {
    name: "Final walkthrough / punch list",
    appliesTo: "visit",
    visitPhase: "final_walkthrough",
    sortOrder: 4,
    fields: [
      { id: "punch_list", label: "Open items", type: "long_text", required: false },
      { id: "photos", label: "Photos", type: "photo", required: false },
      { id: "customer_signature", label: "Customer signature", type: "signature", required: true },
      { id: "customer_accept", label: "Customer accepts work", type: "checkbox", required: true },
    ],
  },
];
