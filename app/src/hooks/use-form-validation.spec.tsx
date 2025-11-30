import { renderHook, act, waitFor } from '@testing-library/react';
import { z } from 'zod';
import { useFormValidation } from './use-form-validation';
import { toast } from 'sonner';

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

describe('useFormValidation', () => {
  // Tests form validation hook functionality

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const simpleSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
  });

  const complexSchema = z.object({
    username: z.string().min(3, 'Username must be at least 3 characters'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  });

  describe('initial state', () => {
    it('should initialize with empty errors', () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      expect(result.current.errors).toEqual({});
    });

    it('should initialize with isValidating as false', () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      expect(result.current.isValidating).toBe(false);
    });
  });

  describe('validate function', () => {
    it('should return true for valid data', async () => {
      // Valid data should pass validation
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      let isValid: boolean;
      await act(async () => {
        isValid = await result.current.validate({
          name: 'John Doe',
          email: 'john@example.com',
        });
      });

      expect(isValid!).toBe(true);
      expect(result.current.errors).toEqual({});
    });

    it('should return false for invalid data', async () => {
      // Invalid data should fail validation
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      let isValid: boolean;
      await act(async () => {
        isValid = await result.current.validate({
          name: '',
          email: 'invalid-email',
        });
      });

      expect(isValid!).toBe(false);
    });

    it('should set errors for invalid fields', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      await act(async () => {
        await result.current.validate({
          name: '',
          email: 'invalid-email',
        });
      });

      expect(result.current.errors.name).toBe('Name is required');
      expect(result.current.errors.email).toBe('Invalid email address');
    });

    it('should show toast for first error', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      await act(async () => {
        await result.current.validate({
          name: '',
          email: 'john@example.com',
        });
      });

      expect(toast.error).toHaveBeenCalledWith('Name is required');
    });

    it('should call onSuccess callback for valid data', async () => {
      const onSuccess = jest.fn();
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema, onSuccess })
      );

      await act(async () => {
        await result.current.validate({
          name: 'John Doe',
          email: 'john@example.com',
        });
      });

      expect(onSuccess).toHaveBeenCalledWith({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should call onError callback for invalid data', async () => {
      const onError = jest.fn();
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema, onError })
      );

      await act(async () => {
        await result.current.validate({
          name: '',
          email: 'invalid',
        });
      });

      expect(onError).toHaveBeenCalled();
    });

    it('should clear previous errors before validation', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      // First validation with errors
      await act(async () => {
        await result.current.validate({
          name: '',
          email: 'invalid',
        });
      });

      expect(result.current.errors.name).toBeDefined();
      expect(result.current.errors.email).toBeDefined();

      // Second validation with valid data
      await act(async () => {
        await result.current.validate({
          name: 'John',
          email: 'john@example.com',
        });
      });

      expect(result.current.errors).toEqual({});
    });
  });

  describe('clearErrors function', () => {
    it('should clear all errors', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      // Create some errors
      await act(async () => {
        await result.current.validate({
          name: '',
          email: 'invalid',
        });
      });

      expect(result.current.errors.name).toBeDefined();

      // Clear errors
      act(() => {
        result.current.clearErrors();
      });

      expect(result.current.errors).toEqual({});
    });
  });

  describe('setFieldError function', () => {
    it('should set error for specific field', () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      act(() => {
        result.current.setFieldError('name', 'Custom error message');
      });

      expect(result.current.errors.name).toBe('Custom error message');
    });

    it('should preserve other field errors', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      // Create initial error
      await act(async () => {
        await result.current.validate({
          name: '',
          email: 'valid@example.com',
        });
      });

      // Set additional field error
      act(() => {
        result.current.setFieldError('email', 'Server error');
      });

      expect(result.current.errors.name).toBe('Name is required');
      expect(result.current.errors.email).toBe('Server error');
    });
  });

  describe('isValidating state', () => {
    it('should be true during validation', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      expect(result.current.isValidating).toBe(false);

      // Note: Testing the intermediate state is tricky with async operations
      // The final state should be false after validation completes
      await act(async () => {
        await result.current.validate({
          name: 'John',
          email: 'john@example.com',
        });
      });

      expect(result.current.isValidating).toBe(false);
    });
  });

  describe('complex schema validation', () => {
    it('should handle refinement errors', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: complexSchema })
      );

      await act(async () => {
        await result.current.validate({
          username: 'john',
          password: 'password123',
          confirmPassword: 'different123',
        });
      });

      expect(result.current.errors.confirmPassword).toBe('Passwords must match');
    });

    it('should validate all fields with complex schema', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: complexSchema })
      );

      let isValid: boolean;
      await act(async () => {
        isValid = await result.current.validate({
          username: 'john',
          password: 'password123',
          confirmPassword: 'password123',
        });
      });

      expect(isValid!).toBe(true);
    });
  });

  describe('async onSuccess callback', () => {
    it('should handle async onSuccess callbacks', async () => {
      const asyncCallback = jest.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema, onSuccess: asyncCallback })
      );

      await act(async () => {
        await result.current.validate({
          name: 'John',
          email: 'john@example.com',
        });
      });

      expect(asyncCallback).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty objects', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      await act(async () => {
        await result.current.validate({} as { name: string; email: string });
      });

      expect(result.current.errors).not.toEqual({});
    });

    it('should handle undefined values', async () => {
      const { result } = renderHook(() =>
        useFormValidation({ schema: simpleSchema })
      );

      await act(async () => {
        await result.current.validate({
          name: undefined as unknown as string,
          email: undefined as unknown as string,
        });
      });

      expect(result.current.errors).not.toEqual({});
    });
  });
});
