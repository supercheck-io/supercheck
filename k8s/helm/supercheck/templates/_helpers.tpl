{{/*
Expand the name of the chart.
*/}}
{{- define "supercheck.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "supercheck.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "supercheck.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Common labels
*/}}
{{- define "supercheck.labels" -}}
helm.sh/chart: {{ include "supercheck.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "supercheck.selectorLabels" -}}
app.kubernetes.io/name: {{ include "supercheck.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component labels
*/}}
{{- define "supercheck.componentLabels" -}}
app.kubernetes.io/component: {{ . }}
{{- end }}

{{/*
Component fullnames
*/}}
{{- define "supercheck.app.fullname" -}}
{{ printf "%s-app" (include "supercheck.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "supercheck.worker.fullname" -}}
{{ printf "%s-worker" (include "supercheck.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "supercheck.postgres.fullname" -}}
{{ printf "%s-postgres" (include "supercheck.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "supercheck.redis.fullname" -}}
{{ printf "%s-redis" (include "supercheck.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "supercheck.minio.fullname" -}}
{{ printf "%s-minio" (include "supercheck.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Service account name
*/}}
{{- define "supercheck.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- if .Values.serviceAccount.name -}}
{{- .Values.serviceAccount.name -}}
{{- else -}}
{{- include "supercheck.fullname" . -}}
{{- end -}}
{{- else -}}
{{- if .Values.serviceAccount.name -}}
{{- .Values.serviceAccount.name -}}
{{- else -}}
default
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Secret name helper
*/}}
{{- define "supercheck.secretName" -}}
{{- if .Values.secrets.name -}}
{{- .Values.secrets.name -}}
{{- else -}}
{{- printf "%s-secret" (include "supercheck.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}
