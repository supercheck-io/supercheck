import { Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';
import { Logger } from '@nestjs/common';

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  /**
   * Validates input data against a Zod schema
   */
  validate<T>(schema: ZodSchema<T>, data: unknown): T {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map(
          (err) => `${err.path.join('.')}: ${err.message}`,
        );

        this.logger.warn('Validation failed:', errorMessages);

        throw new BadRequestException({
          message: 'Validation failed',
          errors: errorMessages,
        });
      }
      throw error;
    }
  }

  /**
   * Safely validates input data, returning null if validation fails
   */
  safeValidate<T>(schema: ZodSchema<T>, data: unknown): T | null {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        this.logger.debug('Safe validation failed:', error.errors);
        return null;
      }
      throw error;
    }
  }

  /**
   * Validates and transforms input data with custom error handling
   */
  validateWithTransform<T, U>(
    schema: ZodSchema<T>,
    data: unknown,
    transform: (validated: T) => U,
  ): U {
    const validated = this.validate(schema, data);
    return transform(validated);
  }
}
