'use client';

import {
  ApiOutlined,
  BellOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FileTextOutlined,
  KeyOutlined,
  LineChartOutlined,
  SettingOutlined,
  ToolOutlined,
  UserOutlined
} from '@ant-design/icons';
import { Card, Col, Layout, Menu, Row, Space, Statistic, Tag, Typography } from 'antd';
import Link from 'next/link';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: 'home', icon: <DashboardOutlined />, label: <Link href="/">首页</Link> },
  { key: 'profile', icon: <UserOutlined />, label: <Link href="/account">个人中心</Link> },
  { key: 'token', icon: <KeyOutlined />, label: <Link href="/token">令牌</Link> },
  { key: 'logs', icon: <FileTextOutlined />, label: <Link href="/log">日志</Link> },
  { key: 'billing', icon: <CreditCardOutlined />, label: <Link href="/pricing">费用说明</Link> },
  { key: 'status', icon: <LineChartOutlined />, label: '服务状态' },
  { key: 'settings', icon: <SettingOutlined />, label: '通知设置' },
  { key: 'admin', icon: <ToolOutlined />, label: <Link href="/admin">管理后台</Link> }
];

export default function HomePage() {
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
            <BellOutlined />
            <Tag color="blue">T07 Token</Tag>
          </Space>
        </Header>

        <Content style={{ padding: 24 }}>
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            <Card>
              <Space orientation="vertical" size={12}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  管理后台基础已接入
                </Typography.Title>
                <Typography.Text type="secondary">
                  当前阶段支持用户注册登录、管理员配置上游与模型分组、用户创建 API 令牌并完成独立鉴权验证。
                </Typography.Text>
                <Space>
                  <Link className="primary-link-button" href="/login">
                    登录
                  </Link>
                <Link className="secondary-link-button" href="/token">
                  令牌管理
                  </Link>
                </Space>
              </Space>
            </Card>

            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic title="前端状态" value="Ready" />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic title="认证接口" value="/auth" />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic title="当前任务" value="T07" suffix="令牌管理" />
                </Card>
              </Col>
            </Row>
          </Space>
        </Content>
      </Layout>
    </Layout>
  );
}
