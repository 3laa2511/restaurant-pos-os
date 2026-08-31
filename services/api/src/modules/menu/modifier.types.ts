export interface ModifierGroup {
  id: string;
  nameAr: string;
  nameEn: string;
  minSelections: number;
  maxSelections: number;
  required: boolean;
}

export interface ModifierOption {
  id: string;
  groupId: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
  active: boolean;
}

export interface SelectedModifier {
  groupId: string;
  optionId: string;
  nameSnapshot: string;
  priceDelta: number;
}

export function validateModifierSelection(
  group: ModifierGroup,
  selections: readonly SelectedModifier[],
): void {
  const count = selections.length;
  if (count < group.minSelections || count > group.maxSelections) {
    throw new Error(`Invalid selections for modifier group ${group.id}`);
  }
  if (group.required && count === 0) {
    throw new Error(`Modifier group ${group.id} requires a selection`);
  }
}
