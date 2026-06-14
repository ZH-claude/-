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
  UserOutlined
} from '@ant-design/icons';
import { Card, Col, Layout, Menu, Row, Space, Statistic, Tag, Typography } from 'antd';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: 'home', icon: <DashboardOutlined />, label: '主页' },
  { key: 'profile', icon: <UserOutlined />, label: '个人中心' },
  { key: 'token', icon: <KeyOutlined />, label: '令牌' },
  { key: 'logs', icon: <FileTextOutlined />, label: '日志' },
  { key: 'billing', icon: <CreditCardOutlined />, label: '余额充值' },
  { key: 'status', icon: <LineChartOutlined />, label: '服务状态' },
  { key: 'settings', icon: <SettingOutlined />, label: '通知设置' }
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
            <Tag color="blue">T01 Scaffold</Tag>
          </Space>
        </Header>

        <Content style={{ padding: 24 }}>
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            <Card>
              <Space orientation="vertical" size={8}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  后台壳页面
                </Typography.Title>
                <Typography.Text type="secondary">
                  当前阶段只验证前端、后端、PostgreSQL、Redis 和 Docker Compose 的基础启动链路。
                </Typography.Text>
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
                  <Statistic title="后端健康检查" value="/health" />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card>
                  <Statistic title="当前任务" value="T01" suffix="骨架" />
                </Card>
              </Col>
            </Row>
          </Space>
        </Content>
      </Layout>
    </Layout>
  );
}
