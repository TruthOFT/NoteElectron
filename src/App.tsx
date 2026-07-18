import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Group,
  NavLink,
  Paper,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconBell,
  IconBook2,
  IconFileText,
  IconNotes,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react';
import InkCanvas from './components/InkCanvas';
import './App.css';

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Group gap="sm" px="md" mb={28}>
          <ThemeIcon size={38} radius="md" variant="gradient" gradient={{ from: 'indigo', to: 'cyan', deg: 135 }}>
            <IconNotes size={22} stroke={2.2} />
          </ThemeIcon>
          <div className="brand-copy">
            <Text fw={750} size="lg" lh={1.1}>Note</Text>
            <Text size="xs" c="dimmed">个人知识空间</Text>
          </div>
        </Group>

        <Button fullWidth leftSection={<IconPlus size={18} />} size="md" radius="md" mb="xl">
          新建页面
        </Button>

        <Stack gap={4}>
          <NavLink label="画布" leftSection={<IconPencil size={19} />} active variant="light" />
          <NavLink label="全部笔记" leftSection={<IconFileText size={19} />} />
          <NavLink label="笔记本" leftSection={<IconBook2 size={19} />} />
        </Stack>

        <Paper className="canvas-tip" radius="lg" p="md" mt="auto">
          <Text fw={700} size="sm">笔刷原型</Text>
          <Text size="xs" c="dimmed" mt={4}>支持压感、速度变细和高 DPI 渲染。</Text>
        </Paper>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <TextInput
            className="search"
            placeholder="搜索笔记"
            leftSection={<IconSearch size={18} />}
            size="md"
            radius="md"
          />
          <Group gap="xs">
            <Tooltip label="通知">
              <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="通知">
                <IconBell size={20} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="设置">
              <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="设置">
                <IconSettings size={20} />
              </ActionIcon>
            </Tooltip>
            <Avatar color="indigo" radius="xl" size={36}>H</Avatar>
          </Group>
        </header>

        <section className="canvas-page">
          <Group justify="space-between" align="flex-end" mb="lg">
            <div>
              <Group gap="sm" mb={3}>
                <Title order={2}>无标题画布</Title>
                <Badge variant="light" color="teal">实时墨迹</Badge>
              </Group>
              <Text size="sm" c="dimmed">鼠标、触控笔都可直接书写；触控笔压力会改变线宽。</Text>
            </div>
          </Group>
          <InkCanvas />
        </section>
      </main>
    </div>
  );
}
