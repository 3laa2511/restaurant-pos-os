import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

class ReceiptItemDto {
  @IsString() @Length(1, 128)
  ingredientId!: string;

  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001)
  quantityPurchaseUnit!: number;

  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0)
  unitCost!: number;
}

export class CreateIngredientDto {
  @IsString() @Length(1, 64) sku!: string;
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsString() @Length(1, 200) nameAr?: string;
  @IsString() @Length(1, 32) baseUnit!: string;
  @IsString() @Length(1, 32) purchaseUnit!: string;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) purchaseUnitFactor!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) reorderLevel?: number;
}

export class ReceiveInventoryDto {
  @IsString() @Length(1, 128) branchId!: string;
  @IsOptional() @IsString() @Length(1, 128) supplierId?: string;
  @IsOptional() @IsString() @Length(1, 200) reference?: string;
  @IsString() @Length(16, 128) idempotencyKey!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];
}

export class AdjustInventoryDto {
  @IsString() @Length(1, 128) branchId!: string;
  @IsString() @Length(1, 128) ingredientId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantityBaseUnit!: number;
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @IsString() @Length(1, 500) reason!: string;
  @IsString() @Length(16, 128) idempotencyKey!: string;
}

export class CreateTransferDto {
  @IsString() @Length(1, 128) fromWarehouseId!: string;
  @IsString() @Length(1, 128) toWarehouseId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TransferItemDto)
  items!: TransferItemDto[];
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
}

class TransferItemDto {
  @IsString() @Length(1, 128) ingredientId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantityBaseUnit!: number;
}

class RecipeItemDto {
  @IsString() @Length(1, 128) ingredientId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantityBaseUnit!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) wastePercent?: number;
}

export class SetRecipeDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => RecipeItemDto)
  items!: RecipeItemDto[];
}
