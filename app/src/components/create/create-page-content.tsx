"use client";
import React from "react";
import { CreateCard } from "./create-card";
import { useRouter } from "next/navigation";
import {
  Video,
  Clock,
  Zap,
  Variable,
  Shield,
  Bell,
  Tally4,
} from "lucide-react";
import { monitorTypes } from "@/components/monitors/data";
import { types } from "@/components/tests/data";

type ScriptType = "browser" | "api" | "custom" | "database" | "record";

export function CreatePageContent() {
  const router = useRouter();

  const handleScriptSelection = (scriptType: ScriptType) => {
    // Navigate to the playground page with the script type as a query parameter
    router.push(`/playground?scriptType=${scriptType}`);
  };

  const testTypes = [
    ...types.map((type) => ({
      icon: <type.icon size={20} className={type.color} />,
      title: type.label,
      path: `/create/${type.value}`,
      scriptType: type.value as ScriptType,
    })),
    {
      icon: <Video size={20} className="text-red-500" />,
      title: "Record",
      path: "https://chromewebstore.google.com/detail/playwright-crx/jambeljnbnfbkcpnoiaedcabbgmnnlcd",
      scriptType: "record" as ScriptType,
    },
  ];

  const jobTypes = [
    {
      icon: <Clock size={20} className="text-blue-500" />,
      title: "Scheduled Job",
      onClick: () => router.push("/jobs/create"),
    },
    {
      icon: <Zap size={20} className="text-amber-500" />,
      title: "Immediate Job",
      onClick: () => router.push("/jobs/create"),
    },
  ];

  const variableTypes = [
    {
      icon: <Variable size={20} className="text-cyan-500" />,
      title: "Variable",
      onClick: () => router.push("/variables"),
    },
    {
      icon: <Shield size={20} className="text-red-500" />,
      title: "Secret",
      onClick: () => router.push("/variables?filter=secrets"),
    },
  ];

  const statusPageTypes = [
    {
      icon: <Tally4 size={20} className="text-green-600" />,
      title: "Status Page",
      onClick: () => router.push("/status-pages"),
    },
  ];

  const notificationTypes = [
    {
      icon: <Bell size={20} className="text-orange-500" />,
      title: "Notification Channel",
      onClick: () => router.push("/alerts"),
    },
  ];

  return (
    <div className="mx-auto p-4 mt-3">
      <div className="mb-2 pl-1">
        <h2 className="text-base font-semibold">Create New Test</h2>
        <p className="text-muted-foreground text-xs mt-1">
          Select the type of test you want to create
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {testTypes.map((testType) => (
          <CreateCard
            key={testType.scriptType || testType.title}
            icon={testType.icon}
            title={testType.title}
            onClick={() =>
              testType.title === "Record"
                ? window.open(testType.path, "_blank")
                : testType.scriptType
                ? handleScriptSelection(testType.scriptType as ScriptType)
                : undefined
            }
            className={testType.title === "Record" ? "border-dashed" : ""}
          />
        ))}
      </div>

      <div className="mt-5 mb-2 pl-1">
        <h2 className="text-base font-semibold">Create New Job</h2>
        <p className="text-muted-foreground text-xs mt-1">
          Configure a new automated or manual job
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {jobTypes.map((jobType) => (
          <CreateCard
            key={jobType.title}
            icon={jobType.icon}
            title={jobType.title}
            onClick={jobType.onClick}
          />
        ))}
      </div>

      <div className="mt-5 mb-2 pl-1">
        <h2 className="text-base font-semibold">Create New Monitor</h2>
        <p className="text-muted-foreground text-xs mt-1">
          Select the type of uptime monitor you want to create
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {monitorTypes.map((monitorType) => {
          const IconComponent = monitorType.icon;
          return (
            <CreateCard
              key={monitorType.value}
              icon={<IconComponent size={20} className={monitorType.color} />}
              title={monitorType.label}
              onClick={() =>
                router.push(`/monitors/create?type=${monitorType.value}`)
              }
            />
          );
        })}
      </div>

      <div className="mt-5 mb-2 pl-1">
        <h2 className="text-base font-semibold">Create Status Page</h2>
        <p className="text-muted-foreground text-xs mt-1">
          Create and manage public status pages for your services
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {statusPageTypes.map((statusPageType) => (
          <CreateCard
            key={statusPageType.title}
            icon={statusPageType.icon}
            title={statusPageType.title}
            onClick={statusPageType.onClick}
          />
        ))}
      </div>

      <div className="mt-5 mb-2 pl-1">
        <h2 className="text-base font-semibold">Create Variables & Secrets</h2>
        <p className="text-muted-foreground text-xs mt-1">
          Configure environment variables and secure secrets
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {variableTypes.map((variableType) => (
          <CreateCard
            key={variableType.title}
            icon={variableType.icon}
            title={variableType.title}
            onClick={variableType.onClick}
          />
        ))}
      </div>

      <div className="mt-5 mb-2 pl-1">
        <h2 className="text-base font-semibold">
          Create Notification Provider
        </h2>
        <p className="text-muted-foreground text-xs mt-1">
          Configure alert notifications and view delivery history
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-2">
        {notificationTypes.map((notificationType) => (
          <CreateCard
            key={notificationType.title}
            icon={notificationType.icon}
            title={notificationType.title}
            onClick={notificationType.onClick}
          />
        ))}
      </div>
    </div>
  );
}
