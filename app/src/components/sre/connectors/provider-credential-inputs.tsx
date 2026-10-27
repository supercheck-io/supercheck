"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { ProviderCredentialField } from "./provider-credential-fields";

export function ProviderCredentialInputs({
  idPrefix,
  fields,
  values,
  onChange,
}: {
  idPrefix: string;
  fields: ProviderCredentialField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        return (
          <div
            key={field.key}
            className={`flex min-w-0 flex-col gap-1.5 ${field.multiline ? "sm:col-span-2" : ""}`}
          >
            <Label htmlFor={id}>
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            {field.multiline ? (
              <Textarea
                id={id}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={field.placeholder}
                rows={4}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                style={
                  field.secret
                    ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties)
                    : undefined
                }
              />
            ) : (
              <Input
                id={id}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                type={field.secret ? "password" : "text"}
                autoComplete={field.secret ? "new-password" : "off"}
                placeholder={field.placeholder}
              />
            )}
            {field.help ? (
              <p className="text-xs text-muted-foreground">{field.help}</p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
