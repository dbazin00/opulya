"use client";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";

type Choice = {
  value: string;
  label: ReactNode;
  text: string;
  disabled?: boolean;
};
type Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function SelectControl({
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  required,
  name,
  className = "",
  ...props
}: Props & { options: Choice[] }) {
  const t = useTranslations();
  const fallback = options.find((option) => !option.disabled)?.value ?? "";
  const [internal, setInternal] = useState(defaultValue ?? fallback);
  const [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreBackground = useRef<(() => void) | undefined>(undefined);
  const errorId = useId();
  const requested = value ?? internal;
  const selected = options.some((option) => option.value === requested)
    ? requested
    : fallback;
  const inactive = disabled || options.length === 0;
  const change = (next: string) => {
    if (value === undefined) setInternal(next);
    setInvalid(false);
    onValueChange?.(next);
  };
  useEffect(() => () => restoreBackground.current?.(), []);
  useEffect(() => {
    const form = trigger.current?.closest("form");
    const reset = () => {
      if (value === undefined) setInternal(defaultValue ?? fallback);
      setInvalid(false);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [value, defaultValue, fallback]);
  const restore = () => {
    restoreBackground.current?.();
    restoreBackground.current = undefined;
  };
  const makeBackgroundInert = (content: HTMLDivElement | null) => {
    if (!content) return;
    restore();
    // Keep background tab stops inert, including the parent dialog of a nested menu.
    const previous = Array.from(document.body.children)
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && !element.contains(content),
      )
      .map((element) => ({ element, inert: element.inert }));
    previous.forEach(({ element }) => {
      element.inert = true;
    });
    restoreBackground.current = () =>
      previous.forEach(({ element, inert }) => {
        element.inert = inert;
      });
  };
  return (
    <span className={`select-control ${className}`}>
      <Select.Root
        value={options.length ? `choice:${selected}` : ""}
        disabled={inactive}
        onValueChange={(next) => change(next.slice("choice:".length))}
        onOpenChange={(open) => {
          if (!open) restore();
        }}
      >
        <Select.Trigger
          ref={trigger}
          {...props}
          title={options.find((option) => option.value === selected)?.text}
          className="styled-select"
          aria-required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [props["aria-describedby"], invalid ? errorId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <Select.Value placeholder={t("common.none")} />
          <Select.Icon className="select-chevron">
            <ChevronDown size={16} aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            ref={makeBackgroundInert}
            className="select-content"
            position="popper"
            align="start"
            sideOffset={6}
            collisionPadding={12}
          >
            <Select.ScrollUpButton className="select-scroll">
              <ChevronUp size={16} aria-hidden="true" />
            </Select.ScrollUpButton>
            <Select.Viewport className="select-viewport" role="group" tabIndex={0}>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={`choice:${option.value}`}
                  data-value={option.value}
                  textValue={option.text}
                  disabled={option.disabled}
                  className="select-item"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-check">
                    <Check size={16} aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="select-scroll">
              <ChevronDown size={16} aria-hidden="true" />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {/* Preserve native FormData, reset and required validation with actual empty values. */}
      <select
        className="select-form-bridge"
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        value={selected}
        disabled={inactive}
        required={required}
        onChange={(event) => change(event.target.value)}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
        }}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.text}
          </option>
        ))}
      </select>
      {invalid && (
        <small id={errorId} className="select-error">
          {t("common.required")}
        </small>
      )}
    </span>
  );
}

function plainText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? plainText(child.props.children)
        : String(child),
    )
    .join("");
}

// Existing localized option declarations share the same control as rich language choices.
export function Dropdown({
  children,
  ...props
}: Props & { children: ReactNode }) {
  const options = Children.toArray(children)
    .filter(
      isValidElement<{
        value?: string;
        disabled?: boolean;
        children?: ReactNode;
      }>,
    )
    .map((option) => {
      const text = plainText(option.props.children);
      return {
        value: String(option.props.value ?? text),
        label: option.props.children,
        text,
        disabled: option.props.disabled,
      };
    });
  return <SelectControl {...props} options={options} />;
}
