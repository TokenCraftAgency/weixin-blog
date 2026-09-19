import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { UIDialogs } from './ui';
import AboutPage from './pages/AboutPage';
import BlockedPage from './pages/BlockedPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import PostPage from './pages/PostPage';
import SettingsPage from './pages/SettingsPage';

/** 分享链接 /#<6位短ID> → /s/<短ID>（仅在进入时 hash 匹配短 ID 字符集才接管，不碰其他 hash） */
const HASH_SHORT_RE = /^#([23456789a-hjkmnp-tv-z]{6})$/i;

function HashShortRedirect() {
  const { pathname, hash } = useLocation();
  const m = pathname === '/' ? HASH_SHORT_RE.exec(hash) : null;
  if (m) return <Navigate to={`/s/${m[1].toLowerCase()}`} replace />;
  return null;
}

export default function App() {
  return (
    <Layout>
      <UIDialogs />
      <HashShortRedirect />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/post/:id" element={<PostPage />} />
        <Route path="/s/:shortId" element={<PostPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/blocked" element={<BlockedPage />} />
      </Routes>
    </Layout>
  );
}
