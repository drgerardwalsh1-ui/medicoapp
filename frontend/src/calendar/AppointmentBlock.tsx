import { memo } from "react";
import type { AppointmentWithClient } from "./useCalendar";
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
  onDragStart: (e: React.DragEvent, a: AppointmentWithClient) => void;
  onResizeStart: (e: React.PointerEvent, a: AppointmentWithClient) => void;
  /** Replaces appointment.end during an active resize preview. */
  endOverride?: string;
}

const AppointmentBlock = memo(function AppointmentBlock({
  appointment,
  onNavigate,
  onDragStart,
  onResizeStart,
  endOverride,
}: Props) {
  const effectiveEnd = endOverride ?? appointment.end;
  const status = getClientStatus(appointment.client);
  const style = statusStyle(status);
  const top = appointmentTopPx(appointment.start);
  const height = appointmentHeightPx(appointment.start, effectiveEnd);
  const isShort = height < 38;
  const hasMissingDocs = status === "missing";
  const label = appointment.client?.name ?? "Unknown";

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, appointment)}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(appointment.clientId);
      }}
      style={{
        position: "absolute",
        top: `${top}px`,
        height: `${height}px`,
        left: "2px",
        right: "2px",
        zIndex: 10,
        cursor: "pointer",
      }}
      className={[
        "rounded border overflow-hidden select-none",
        style.bg,
        style.border,
        style.text,
        "hover:brightness-95 active:brightness-90 transition-[filter,height] duration-75",
      ].join(" ")}
      title={[
        label,
        `${formatTime(appointment.start)} – ${formatTime(effectiveEnd)}`,
        hasMissingDocs ? "⚠ Documents not uploaded" : "",
      ]
        .filter(Boolean)
        .join("\n")}
    >
      {/* Content */}
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
                <span
                  className="shrink-0 text-xs leading-snug"
                  title="Documents not uploaded"
                >
                  ⚠
                </span>
              )}
            </div>
            <div className="text-xs opacity-80 leading-tight">
              {formatTime(appointment.start)}–{formatTime(effectiveEnd)}
            </div>
            {appointment.type && height >= 56 && (
              <div className="text-xs opacity-70 capitalize leading-tight mt-0.5">
                {appointment.type}
              </div>
            )}
          </>
        )}
      </div>

      {/* Resize handle */}
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
