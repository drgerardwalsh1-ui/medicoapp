import { memo } from "react";
import type { AppointmentWithClient } from "./useCalendar";
import { formatFullName } from "../types/client";
import {
  getClientStatus,
  statusStyle,
  formatTime,
  appointmentTopPx,
  appointmentHeightPx,
} from "./calendarUtils";

interface Props {
  appointment: AppointmentWithClient;
  onNavigate: (clientId: string) => void;
  onBodyPointerDown: (e: React.PointerEvent, a: AppointmentWithClient) => void;
  onResizeStart: (e: React.PointerEvent, a: AppointmentWithClient) => void;
  startOverride?: string;
  endOverride?: string;
  isGhost?: boolean;
}

const AppointmentBlock = memo(function AppointmentBlock({
  appointment,
  onNavigate,
  onBodyPointerDown,
  onResizeStart,
  startOverride,
  endOverride,
  isGhost,
}: Props) {
  const effectiveStart = startOverride ?? appointment.start;
  const effectiveEnd = endOverride ?? appointment.end;
  const status = getClientStatus(appointment.client);
  const style = statusStyle(status);
  const top = appointmentTopPx(effectiveStart);
  const height = appointmentHeightPx(effectiveStart, effectiveEnd);
  const isShort = height < 38;
  const hasMissingDocs = status === "missing";
  const label = formatFullName(appointment.client?.identity) || "Unknown";

  return (
    <div
      onPointerDown={(e) => {
        // Only handle primary button, ignore resize handle (bottom strip)
        if (e.button !== 0) return;
        onBodyPointerDown(e, appointment);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(appointment.client.id);
      }}
      style={{
        position: "absolute",
        top: `${top}px`,
        height: `${height}px`,
        left: "2px",
        right: "2px",
        zIndex: 10,
        cursor: isGhost ? "grabbing" : "grab",
        opacity: isGhost ? 0.85 : 1,
      }}
      className={[
        "rounded border overflow-hidden select-none",
        style.bg,
        style.border,
        style.text,
        "hover:brightness-95 active:brightness-90 transition-[filter,height,opacity] duration-75",
      ].join(" ")}
      title={[
        label,
        `${formatTime(effectiveStart)} – ${formatTime(effectiveEnd)}`,
        hasMissingDocs ? "⚠ Documents not uploaded" : "",
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <div className="px-1.5 pt-0.5 pb-3 h-full overflow-hidden pointer-events-none">
        {isShort ? (
          <span className="text-xs font-medium truncate block leading-tight">
            {label}
            {hasMissingDocs && " ⚠"}
          </span>
        ) : (
          <>
            <div className="flex items-start gap-0.5">
              <span className="text-xs font-semibold truncate leading-snug flex-1">
                {label}
              </span>
              {hasMissingDocs && (
                <span className="shrink-0 text-xs leading-snug" title="Documents not uploaded">
                  ⚠
                </span>
              )}
            </div>
            <div className="text-xs opacity-80 leading-tight">
              {formatTime(effectiveStart)}–{formatTime(effectiveEnd)}
            </div>
            {appointment.type && height >= 56 && (
              <div className="text-xs opacity-70 capitalize leading-tight mt-0.5">
                {appointment.type}
              </div>
            )}
          </>
        )}
      </div>

      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onResizeStart(e, appointment);
        }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 8,
          cursor: "ns-resize",
          borderRadius: "0 0 3px 3px",
        }}
        className="bg-black/20 hover:bg-black/35 transition-colors"
      />
    </div>
  );
});

export default AppointmentBlock;
