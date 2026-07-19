import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ActionIcon,
  ColorSwatch,
  Divider,
  Group,
  Popover,
  Slider,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconFileTypePdf,
  IconGripVertical,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react';

type FloatingInkToolbarProps = {
  colors: string[];
  color: string;
  brushPresets: number[];
  selectedBrushPreset: number;
  sharpness: number;
  pressureSensitivity: number;
  canUndo: boolean;
  onColorChange: (color: string) => void;
  onBrushPresetSelect: (index: number) => void;
  onBrushPresetSizeChange: (index: number, value: number) => void;
  onSharpnessChange: (value: number) => void;
  onPressureSensitivityChange: (value: number) => void;
  onExport: () => Promise<void>;
  onUndo: () => void;
  onClear: () => void;
};

type ToolbarPosition = {
  x: number;
  y: number;
};

const EDGE_GAP = 12;

export default function FloatingInkToolbar({
  colors,
  color,
  brushPresets,
  selectedBrushPreset,
  sharpness,
  pressureSensitivity,
  canUndo,
  onColorChange,
  onBrushPresetSelect,
  onBrushPresetSizeChange,
  onSharpnessChange,
  onPressureSensitivityChange,
  onExport,
  onUndo,
  onClear,
}: FloatingInkToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [position, setPosition] = useState<ToolbarPosition>({ x: EDGE_GAP, y: 16 });

  const constrainPosition = (next: ToolbarPosition): ToolbarPosition => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return next;
    const maximumX = Math.max(EDGE_GAP, window.innerWidth - toolbar.offsetWidth - EDGE_GAP);
    const maximumY = Math.max(EDGE_GAP, window.innerHeight - toolbar.offsetHeight - EDGE_GAP);
    return {
      x: Math.min(maximumX, Math.max(EDGE_GAP, next.x)),
      y: Math.min(maximumY, Math.max(EDGE_GAP, next.y)),
    };
  };

  useLayoutEffect(() => {
    const centerToolbar = () => {
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      setPosition((current) => constrainPosition({
          x: (window.innerWidth - toolbar.offsetWidth) / 2,
          y: current.y,
      }));
    };

    const observer = new ResizeObserver(centerToolbar);
    const toolbar = toolbarRef.current;
    if (toolbar) observer.observe(toolbar);
    centerToolbar();
    window.addEventListener('resize', centerToolbar);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', centerToolbar);
    };
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const bounds = toolbar.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveToolbar = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(constrainPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    }));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={toolbarRef}
      className="ink-toolbar"
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
    >
      <Tooltip label="拖动工具条">
        <ActionIcon
          className="toolbar-drag-handle"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="拖动工具条"
          onPointerDown={startDrag}
          onPointerMove={moveToolbar}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <IconGripVertical size={20} />
        </ActionIcon>
      </Tooltip>

      <Popover width={310} position="bottom-start" shadow="md" withArrow>
        <Popover.Target>
          <ActionIcon variant="light" size="lg" radius="md" aria-label="钢笔设置">
            <IconPencil size={20} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown className="brush-settings">
          <Text fw={700} mb="md">钢笔参数</Text>
          <Stack gap="lg">
            <div>
              <Group justify="space-between" mb={6}>
                <Text size="sm">笔尖锐度</Text>
                <Text size="xs" c="dimmed">{sharpness}%</Text>
              </Group>
              <Slider
                value={sharpness}
                onChange={onSharpnessChange}
                min={0}
                max={100}
                step={5}
                label={(value) => `${value}%`}
                aria-label="笔尖锐度"
              />
            </div>
            <div>
              <Group justify="space-between" mb={6}>
                <Text size="sm">压力灵敏度</Text>
                <Text size="xs" c="dimmed">{pressureSensitivity}% · 越小越省力</Text>
              </Group>
              <Slider
                value={pressureSensitivity}
                onChange={onPressureSensitivityChange}
                min={0}
                max={100}
                step={5}
                label={(value) => `${value}%`}
                aria-label="压力灵敏度"
              />
            </div>
          </Stack>
        </Popover.Dropdown>
      </Popover>

      <Divider orientation="vertical" />
      <Group gap={7} wrap="nowrap">
        {colors.map((item) => (
          <ColorSwatch
            className="ink-color"
            component="button"
            color={item}
            key={item}
            onClick={() => onColorChange(item)}
            size={color === item ? 25 : 21}
            aria-label={`选择颜色 ${item}`}
          />
        ))}
      </Group>

      <Divider orientation="vertical" />
      <Group className="brush-presets" gap={5} wrap="nowrap">
        {brushPresets.map((size, index) => (
          <Popover
            key={index}
            width={260}
            position="bottom"
            shadow="md"
            withArrow
          >
            <Popover.Target>
              <button
                className="brush-preset"
                data-active={selectedBrushPreset === index ? 'true' : 'false'}
                type="button"
                onClick={() => onBrushPresetSelect(index)}
                aria-label={`笔刷预设 ${index + 1}，${size}px`}
              >
                <span
                  className="brush-preset-dot"
                  style={{
                    width: `${Math.min(15, Math.max(4, size * 0.72))}px`,
                    height: `${Math.min(15, Math.max(4, size * 0.72))}px`,
                    backgroundColor: color,
                  }}
                />
              </button>
            </Popover.Target>
            <Popover.Dropdown>
              <Group justify="space-between" mb="sm">
                <Text size="sm" fw={650}>预设 {index + 1}</Text>
                <Text size="sm" c="dimmed">{size}px</Text>
              </Group>
              <Slider
                value={size}
                onChange={(value) => onBrushPresetSizeChange(index, value)}
                min={2}
                max={24}
                step={1}
                label={(value) => `${value}px`}
                aria-label={`调整笔刷预设 ${index + 1}`}
              />
            </Popover.Dropdown>
          </Popover>
        ))}
      </Group>

      <Divider orientation="vertical" />
      <Group gap={4} wrap="nowrap">
        <Tooltip label="导出 PDF">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            onClick={onExport}
            disabled={!canUndo}
            aria-label="导出 PDF"
          >
            <IconFileTypePdf size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="撤销">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="撤销"
          >
            <IconArrowBackUp size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="清空画布">
          <ActionIcon
            variant="subtle"
            color="red"
            size="lg"
            onClick={onClear}
            disabled={!canUndo}
            aria-label="清空画布"
          >
            <IconTrash size={19} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </div>
  );
}
