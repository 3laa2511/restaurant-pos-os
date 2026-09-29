import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DateRangeBranchQueryDto,
  IdParamDto,
  OptionalBranchQueryDto,
  TransferStatusQueryDto,
} from './request.dto.js';

describe('request boundary DTO validation', () => {
  it('accepts a valid optional branch query', async () => {
    const errors = await validate(plainToInstance(OptionalBranchQueryDto, { branchId: 'branch-1' }));
    expect(errors).toHaveLength(0);
  });

  it('rejects empty branch ids and invalid date ranges', async () => {
    const branchErrors = await validate(plainToInstance(OptionalBranchQueryDto, { branchId: '' }));
    const dateErrors = await validate(
      plainToInstance(DateRangeBranchQueryDto, { from: 'not-a-date', to: 'not-a-date' }),
    );

    expect(branchErrors.length).toBeGreaterThan(0);
    expect(dateErrors.length).toBeGreaterThan(0);
  });

  it('accepts only supported transfer statuses', async () => {
    const valid = await validate(plainToInstance(TransferStatusQueryDto, { status: 'DISPATCHED' }));
    const invalid = await validate(plainToInstance(TransferStatusQueryDto, { status: 'HACKED' }));

    expect(valid).toHaveLength(0);
    expect(invalid.length).toBeGreaterThan(0);
  });

  it('rejects an empty path identifier', async () => {
    const errors = await validate(plainToInstance(IdParamDto, { id: '' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-whitelisted request properties at the global-pipe boundary', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    await expect(
      pipe.transform(
        { branchId: 'branch-1', unexpected: true },
        { type: 'query', metatype: OptionalBranchQueryDto, data: '' },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { id: 'resource-1', unexpected: true },
        { type: 'param', metatype: IdParamDto, data: '' },
      ),
    ).rejects.toThrow();
  });
});
