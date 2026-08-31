export interface ComboComponent {
  productId: string;
  quantity: number;
  required: boolean;
  selectable: boolean;
}

export interface ComboDefinition {
  id: string;
  nameAr: string;
  nameEn: string;
  fixedPrice: number;
  components: readonly ComboComponent[];
  active: boolean;
}

export function validateCombo(definition: ComboDefinition): void {
  if (!definition.nameAr.trim() || !definition.nameEn.trim()) {
    throw new Error('Combo names are required');
  }
  if (!Number.isFinite(definition.fixedPrice) || definition.fixedPrice < 0) {
    throw new Error('Combo price must be non-negative');
  }
  if (definition.components.length === 0) {
    throw new Error('Combo must contain at least one component');
  }
  for (const component of definition.components) {
    if (!component.productId.trim() || !Number.isInteger(component.quantity) || component.quantity < 1) {
      throw new Error('Invalid combo component');
    }
  }
}
