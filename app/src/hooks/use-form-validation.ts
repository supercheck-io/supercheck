import { useState, useCallback } from "react"
import { z } from "zod"
import { toast } from "sonner"

interface UseFormValidationProps<T> {
  schema: z.ZodSchema<T>
  onSuccess?: (data: T) => void | Promise<void>
  onError?: (errors: Partial<T>) => void
}

export function useFormValidation<T extends Record<string, unknown>>({
  schema,
  onSuccess,
  onError,
}: UseFormValidationProps<T>) {
  const [errors, setErrors] = useState<Partial<T>>({})
  const [isValidating, setIsValidating] = useState(false)

  const validate = useCallback(
    async (data: T): Promise<boolean> => {
      setIsValidating(true)
      setErrors({})

      try {
        const validatedData = schema.parse(data)
        onSuccess?.(validatedData)
        return true
      } catch (error) {
        if (error instanceof z.ZodError) {
          const newErrors: Partial<T> = {}
          
          error.errors.forEach((err) => {
            if (err.path) {
              const field = err.path[0] as keyof T
              newErrors[field] = err.message as T[keyof T]
            }
          })
          
          setErrors(newErrors)
          onError?.(newErrors)
          
          // Show first error in toast
          if (newErrors[Object.keys(newErrors)[0] as keyof T]) {
            toast.error(newErrors[Object.keys(newErrors)[0] as keyof T] as string)
          }
        }
        return false
      } finally {
        setIsValidating(false)
      }
    },
    [schema, onSuccess, onError]
  )

  const clearErrors = useCallback(() => {
    setErrors({})
  }, [])

  const setFieldError = useCallback((field: keyof T, message: string) => {
    setErrors(prev => ({ ...prev, [field]: message }))
  }, [])

  return {
    errors,
    isValidating,
    validate,
    clearErrors,
    setFieldError,
  }
} 