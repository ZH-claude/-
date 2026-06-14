'use client';

import {
  ApiOutlined,
  BellOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FileTextOutlined,
  KeyOutlined,
  LineChartOutlined,
  NotificationOutlined,
  PictureOutlined,
  SettingOutlined,
  ToolOutlined,
  UserOutlined
} from '@ant-design/icons';
import { Alert, Card, Col, Empty, Layout, List, Menu, Row, Space, Spin, Statistic, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listPublishedAnnouncements } from './lib/announcements-api';
import type { AnnouncementFeedResponse, AnnouncementSection } from './lib/announcements-api';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: 'home', icon: <DashboardOutlined />, label: <Link href="/">首页</Link> },
  { key: 'profile', icon: <UserOutlined />, label: <Link href="/account">个人中心</Link> },
  { key: 'token', icon: <KeyOutlined />, label: <Link href="/token">令牌</Link> },
  { key: 'logs', icon: <FileTextOutlined />, label: <Link href="/log">日志</Link> },
  { key: 'task', icon: <ClockCircleOutlined />, label: <Link href="/task">异步任务</Link> },
  { key: 'midjourney', icon: <PictureOutlined />, label: <Link href="/midjourney">绘图日志</Link> },
  { key: 'billing', icon: <CreditCardOutlined />, label: <Link href="/pricing">费用说明</Link> },
  { key: 'status', icon: <LineChartOutlined />, label: <Link href="/groupAvailability">分组状态</Link> },
  { key: 'settings', icon: <SettingOutlined />, label: <Link href="/account/notificationSettings">通知设置</Link> },
  { key: 'admin', icon: <ToolOutlined />, label: <Link href="/admin">管理后台</Link> }
];

const documentEntries = [
  { title: '令牌管理', href: '/token', icon: <KeyOutlined /> },
  { title: '费用说明', href: '/pricing', icon: <CreditCardOutlined /> },
  { title: '调用日志', href: '/log', icon: <FileTextOutlined /> },
  { title: '异步任务', href: '/task', icon: <ClockCircleOutlined /> },
  { title: '绘图日志', href: '/midjourney', icon: <PictureOutlined /> },
  { title: '余额充值', href: '/account/topup/recharge', icon: <CreditCardOutlined /> },
  { title: '分组状态', href: '/groupAvailability', icon: <LineChartOutlined /> },
  { title: '通知设置', href: '/account/notificationSettings', icon: <BellOutlined /> }
];

const emptyFeed: AnnouncementFeedResponse = {
  generatedAt: '',
  total: 0,
  sections: [
    { key: 'announcement', title: '平台公告', items: [] },
    { key: 'update_log', title: '更新日志', items: [] },
    { key: 'usage_guide', title: '使用建议', items: [] }
  ]
};

export default function HomePage() {
  const [feed, setFeed] = useState<AnnouncementFeedResponse>(emptyFeed);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadAnnouncements() {
      setIsLoading(true);
      setError('');

      try {
        const nextFeed = await listPublishedAnnouncements();
        if (!cancelled) {
          setFeed(nextFeed);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '公告加载失败');
          setFeed(emptyFeed);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAnnouncements();

    return () => {
      cancelled = true;
    };
  }, []);

  const latestPublishedAt = useMemo(() => {
    const publishedTimes = feed.sections
      .flatMap((section) => section.items)
      .map((item) => item.publishedAt ?? item.createdAt)
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());

    return publishedTimes[0] ? formatDate(publishedTimes[0]) : '暂无';
  }, [feed.sections]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0" theme="light" width={224}>
        <div style={{ padding: 20 }}>
          <div className="shell-logo">
            <span className="shell-logo-mark">R</span>
            <span>Relay Console</span>
          </div>
        </div>
        <Menu mode="inline" defaultSelectedKeys={['home']} items={menuItems} />
      </Sider>

      <Layout>
        <Header
          style={{
            alignItems: 'center',
            background: '#ffffff',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            padding: '0 24px'
          }}
        >
          <Space>
            <ApiOutlined />
            <Typography.Text strong>API 中转站后台</Typography.Text>
          </Space>
          <Space>
            <NotificationOutlined />
            <Tag color="blue">T15 首页公告</Tag>
          </Space>
        </Header>

        <Content style={{ padding: 24 }}>
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            {error ? <Alert message={error} showIcon type="error" /> : null}

            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic title="已发布内容" loading={isLoading} suffix="条" value={feed.total} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic title="最新发布" loading={isLoading} value={latestPublishedAt} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic title="文档入口" suffix="个" value={documentEntries.length} />
                </Card>
              </Col>
            </Row>

            {isLoading ? (
              <Card>
                <Spin />
              </Card>
            ) : (
              <Row gutter={[16, 16]}>
                {feed.sections.map((section) => (
                  <Col key={section.key} xs={24} lg={8}>
                    <AnnouncementSectionCard section={section} />
                  </Col>
                ))}
              </Row>
            )}

            <Card title="文档入口">
              <Row gutter={[12, 12]}>
                {documentEntries.map((entry) => (
                  <Col key={entry.href} xs={12} md={8} xl={4}>
                    <Link className="home-doc-link" href={entry.href}>
                      {entry.icon}
                      <span>{entry.title}</span>
                    </Link>
                  </Col>
                ))}
              </Row>
            </Card>
          </Space>
        </Content>
      </Layout>
    </Layout>
  );
}

function AnnouncementSectionCard({ section }: { section: AnnouncementSection }) {
  return (
    <Card title={section.title}>
      {section.items.length ? (
        <List
          dataSource={section.items}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <Typography.Text type="secondary">{formatDate(item.publishedAt ?? item.createdAt)}</Typography.Text>
                </Space>
                <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }} type="secondary">
                  {item.content}
                </Typography.Paragraph>
              </Space>
            </List.Item>
          )}
        />
      ) : (
        <Empty description={`暂无已发布${section.title}`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Card>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
