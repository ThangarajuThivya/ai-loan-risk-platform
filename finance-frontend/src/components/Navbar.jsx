import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Menu, X, ArrowUpRight, LogOut, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import LanguageSwitcher from './LanguageSwitcher';

export default function Navbar() {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const isHome = location.pathname === '/';

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    // Initialize
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Close mobile menu on navigate
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navLinks = [
    { name: t('navbar.home'), path: '/' },
    { name: t('navbar.about'), path: '/about' },
    { name: t('navbar.loans'), path: '/loans' },
    { name: t('navbar.eligibilityChecker'), path: '/eligibility' },
    { name: t('navbar.emiCalculator'), path: '/emi-calculator' },
    { name: t('navbar.aiFeatures'), path: '/ai-features' },
    { name: t('navbar.faq'), path: '/faq' },
    { name: t('navbar.contact'), path: '/contact' },
  ];

  // Dynamic class names for navbar background
  const getNavbarBgClass = () => {
    if (mobileMenuOpen) return 'bg-brand-primary border-b border-white/10';
    if (!isHome) return 'bg-brand-primary shadow-md';
    return scrolled 
      ? 'bg-brand-primary/95 backdrop-blur-md shadow-lg border-b border-white/5 transition-all duration-300'
      : 'bg-transparent transition-all duration-300';
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 ${getNavbarBgClass()} py-4`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 text-white group" id="navbar-logo">
            <div className="bg-brand-accent p-2 rounded-lg transition-transform group-hover:scale-110">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-display font-bold text-xl tracking-tight leading-none">Degital</span>
              <span className="text-[10px] font-mono tracking-widest uppercase text-brand-secondary">AI Loan System</span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden lg:flex items-center space-x-1">
            {navLinks.map((link) => (
              <NavLink
                key={link.path}
                to={link.path}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'text-brand-accent font-semibold border-b-2 border-brand-accent rounded-b-none'
                      : 'text-white/80 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                {link.name}
              </NavLink>
            ))}
          </div>

          {/* Desktop Right Buttons */}
          <div className="hidden lg:flex items-center space-x-3">
            <LanguageSwitcher />
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  className="text-white hover:text-brand-accent px-3 py-2 text-sm font-medium transition-colors flex items-center space-x-1.5"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>{t('navbar.dashboard')}</span>
                </Link>
                <button
                  onClick={handleLogout}
                  type="button"
                  className="bg-white/10 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-white/20 transition-all duration-200 flex items-center space-x-1.5"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t('navbar.logout')}</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-white hover:text-brand-accent px-3 py-2 text-sm font-medium transition-colors"
                >
                  {t('navbar.signIn')}
                </Link>
                <Link
                  to="/register"
                  className="bg-brand-accent text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-accent/90 transition-all duration-200 shadow-sm glow-btn flex items-center space-x-1"
                >
                  <span>{t('navbar.getStarted')}</span>
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex lg:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              className="inline-flex items-center justify-center p-2 rounded-md text-white hover:text-brand-accent hover:bg-white/5 focus:outline-none"
              aria-controls="mobile-menu"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? <X className="block h-6 w-6" /> : <Menu className="block h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-brand-primary border-t border-white/10" id="mobile-menu">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {navLinks.map((link) => (
              <NavLink
                key={link.path}
                to={link.path}
                className={({ isActive }) =>
                  `block px-3 py-3 rounded-md text-base font-medium transition-colors ${
                    isActive
                      ? 'text-brand-accent bg-white/5 font-semibold pl-4 border-l-4 border-brand-accent'
                      : 'text-white/80 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                {link.name}
              </NavLink>
            ))}
          </div>
          <div className="pt-4 pb-6 px-5 border-t border-white/10 space-y-3">
            <LanguageSwitcher variant="inline" />
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  className="block text-center w-full text-white hover:text-brand-accent py-2.5 rounded-md text-base font-medium transition-colors border border-white/15"
                >
                  {t('navbar.dashboard')}
                </Link>
                <button
                  onClick={handleLogout}
                  type="button"
                  className="block text-center w-full bg-white/10 text-white py-3 rounded-lg text-base font-semibold hover:bg-white/20 transition-colors"
                >
                  {t('navbar.logout')}
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="block text-center w-full text-white hover:text-brand-accent py-2.5 rounded-md text-base font-medium transition-colors border border-white/15"
                >
                  {t('navbar.signIn')}
                </Link>
                <Link
                  to="/register"
                  className="block text-center w-full bg-brand-accent text-white py-3 rounded-lg text-base font-semibold hover:bg-brand-accent/90 transition-colors shadow-md"
                >
                  {t('navbar.getStarted')}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
