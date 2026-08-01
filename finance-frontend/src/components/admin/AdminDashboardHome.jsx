import { useState,useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  FileText, 
  CheckCircle, 
  Clock, 
  XCircle, 
  AlertTriangle, 
  DollarSign, 
  Percent,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Shield,
  Eye,
  Award
} from 'lucide-react';
import { MOCK_APPLICATIONS, MOCK_CUSTOMERS} from '../../AdminData';
import api from "../../api/axios";


export default function AdminDashboardHome({ customers,onNavigate, onViewApplication }) {
  const [customersDetails,setCustomersDetails]= useState()

  useEffect(() => {
    
    const getAllCustomers = async () => {
      try {
        const res = await api.get("/admin/getAllCustomer");
        console.log(res.data)

        setCustomersDetails(res.data);
      } catch (error) {
        console.log(error);
        console.log(error.response?.status);
      }
    };
    getAllCustomers();
  }, []);
  // console.log(customersDetails)
  // Compute Stats
  const totalCustomers = customersDetails?.totalCustomers;
  const totalApps = MOCK_APPLICATIONS.length;
  const approvedApps = MOCK_APPLICATIONS.filter(a => a.status === 'Approved');
  const pendingApps = MOCK_APPLICATIONS.filter(a => a.status === 'Pending');
  const rejectedApps = MOCK_APPLICATIONS.filter(a => a.status === 'Rejected');
  
  const highRiskCustomers = MOCK_APPLICATIONS.filter(a => a.riskScore > 70).length;
  const approvalRate = totalApps > 0 ? Math.round((approvedApps.length / (totalApps - pendingApps.length)) * 100) : 0;
  
  // Total disbursed estimation
  const totalDisbursed = approvedApps.reduce((acc, a) => acc + a.amount, 0);

  // Stats Card Config
  const stats = [
    {
      title: 'Total Customers',
      value: totalCustomers,
      icon: Users,
      trend: customersDetails?.growth?.value,
      isPositive: customersDetails?.growth?.isPositive,
      color: 'border-blue-500 bg-blue-50/50 text-blue-600',
    },
    {
      title: 'Loan Applications',
      value: totalApps.toString(),
      icon: FileText,
      trend: '+18.2%',
      isPositive: true,
      color: 'border-indigo-500 bg-indigo-50/50 text-indigo-600',
    },
    {
      title: 'Approved Loans',
      value: approvedApps.length.toString(),
      icon: CheckCircle,
      trend: '+15.1%',
      isPositive: true,
      color: 'border-emerald-500 bg-emerald-50/50 text-emerald-600',
    },
    {
      title: 'Pending Reviews',
      value: pendingApps.length.toString(),
      icon: Clock,
      trend: '-4.2%',
      isPositive: true,
      color: 'border-amber-500 bg-amber-50/50 text-amber-600',
    },
    {
      title: 'Rejected Loans',
      value: rejectedApps.length.toString(),
      icon: XCircle,
      trend: '+8.5%',
      isPositive: false,
      color: 'border-rose-500 bg-rose-50/50 text-rose-600',
    },
    {
      title: 'High Risk Flagged',
      value: highRiskCustomers.toString(),
      icon: AlertTriangle,
      trend: '-1.8%',
      isPositive: true, // fewer high risk is good
      color: 'border-red-500 bg-red-50/50 text-red-600',
    },
    {
      title: 'Estimated Disbursed',
      value: `$${(totalDisbursed / 1000000).toFixed(2)}M`,
      icon: DollarSign,
      trend: '+22.4%',
      isPositive: true,
      color: 'border-teal-500 bg-teal-50/50 text-teal-600',
    },
    {
      title: 'Approval Yield',
      value: `${approvalRate}%`,
      icon: Percent,
      trend: '+3.1%',
      isPositive: true,
      color: 'border-cyan-500 bg-cyan-50/50 text-cyan-600',
    }
  ];

  // Distribution calculations for SVG charts
  const categories = { Personal: 0, Home: 0, Business: 0, Education: 0, Vehicle: 0 };
  MOCK_APPLICATIONS.forEach(a => {
    if (categories[a.loanType] !== undefined) {
      categories[a.loanType]++;
    }
  });

  const riskSlices = { Low: 0, Medium: 0, High: 0 };
  MOCK_APPLICATIONS.forEach(a => {
    if (a.riskScore < 35) riskSlices.Low++;
    else if (a.riskScore <= 70) riskSlices.Medium++;
    else riskSlices.High++;
  });

  // Recent 8 applications
  const recentApplications = MOCK_APPLICATIONS.slice(0, 8);

  const [activeChartTab, setActiveChartTab] = useState('volume');

  return (
    <div className="space-y-8">
      {/* Page Title Panel */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Executive Command Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Real-time credit telemetry, automated risk auditing, and OCR documentation flows.</p>
        </div>
        <div className="flex items-center gap-2 text-xs bg-slate-100 border border-slate-200 text-slate-600 rounded-lg px-3 py-2 font-mono shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          AI CORE ENGINE V3.5 ACTIVE
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.04 }}
              className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all group relative overflow-hidden"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{stat.title}</p>
                  <h3 className="text-2xl font-extrabold text-slate-800 tracking-tight">{stat.value}</h3>
                </div>
                <div className={`p-3 rounded-xl border ${stat.color} transition-transform group-hover:scale-110`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 mt-4 text-xs font-medium">
                {stat.isPositive ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                )}
                <span className={stat.isPositive ? 'text-emerald-600' : 'text-rose-500'}>
                  {stat.trend}
                </span>
                <span className="text-slate-400 font-normal">vs last month</span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </motion.div>
          );
        })}
      </div>

      {/* Analytical Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Dynamic Trend Chart Card */}
        <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Credit Volume Telemetry</h3>
              <p className="text-slate-400 text-xs">Monthly application counts vs approved liquidity</p>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button 
                onClick={() => setActiveChartTab('volume')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${activeChartTab === 'volume' ? 'bg-white text-indigo-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Volumetric Flow
              </button>
              <button 
                onClick={() => setActiveChartTab('categories')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${activeChartTab === 'categories' ? 'bg-white text-indigo-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Product Classes
              </button>
            </div>
          </div>

          {/* SVG Animated Chart */}
          <div className="h-64 flex items-end justify-between px-2 pt-6 relative">
            {activeChartTab === 'volume' ? (
              <>
                {/* Background gridlines */}
                <div className="absolute inset-x-0 top-1/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                <div className="absolute inset-x-0 top-2/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                <div className="absolute inset-x-0 top-3/4 border-t border-dashed border-slate-100 pointer-events-none"></div>

                {/* Bars or wave lines represent monthly data */}
                {[
                  { month: 'Jan', count: 48, approved: 31, rate: 64 },
                  { month: 'Feb', count: 56, approved: 38, rate: 67 },
                  { month: 'Mar', count: 72, approved: 49, rate: 68 },
                  { month: 'Apr', count: 68, approved: 46, rate: 67 },
                  { month: 'May', count: 91, approved: 64, rate: 70 },
                  { month: 'Jun', count: 100, approved: 68, rate: 68 },
                ].map((data, i) => {
                  const maxVal = 120;
                  const totalHeightPercent = (data.count / maxVal) * 100;
                  const approvedHeightPercent = (data.approved / maxVal) * 100;

                  return (
                    <div key={data.month} className="flex-1 flex flex-col items-center group relative h-full">
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none whitespace-nowrap text-center shadow-lg font-mono">
                        <div>Applications: <span className="text-sky-300 font-bold">{data.count}</span></div>
                        <div>Approved: <span className="text-emerald-400 font-bold">{data.approved}</span></div>
                        <div>Yield: <span className="text-amber-300 font-bold">{data.rate}%</span></div>
                      </div>

                      <div className="w-12 h-full flex items-end gap-1.5 relative justify-center">
                        {/* Application volume column */}
                        <motion.div 
                          initial={{ height: 0 }}
                          animate={{ height: `${totalHeightPercent}%` }}
                          transition={{ duration: 0.8, delay: i * 0.05 }}
                          className="w-4 bg-slate-200 group-hover:bg-indigo-300 rounded-t-sm transition-colors cursor-pointer"
                        />
                        {/* Approval liquidity column */}
                        <motion.div 
                          initial={{ height: 0 }}
                          animate={{ height: `${approvedHeightPercent}%` }}
                          transition={{ duration: 0.8, delay: i * 0.05 + 0.1 }}
                          className="w-4 bg-indigo-900 group-hover:bg-indigo-800 rounded-t-sm transition-colors cursor-pointer"
                        />
                      </div>
                      
                      <span className="text-xs font-mono text-slate-400 mt-2">{data.month}</span>
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                {/* Categories Bar Chart */}
                <div className="absolute inset-x-0 top-1/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                <div className="absolute inset-x-0 top-2/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                <div className="absolute inset-x-0 top-3/4 border-t border-dashed border-slate-100 pointer-events-none"></div>

                {Object.entries(categories).map(([cat, val], i) => {
                  const maxVal = Math.max(...Object.values(categories)) * 1.2;
                  const heightPercent = (val / maxVal) * 100;
                  const colors = [
                    'bg-sky-500 hover:bg-sky-600',
                    'bg-indigo-900 hover:bg-indigo-950',
                    'bg-emerald-500 hover:bg-emerald-600',
                    'bg-amber-500 hover:bg-amber-600',
                    'bg-purple-600 hover:bg-purple-700'
                  ];

                  return (
                    <div key={cat} className="flex-1 flex flex-col items-center group relative h-full">
                      <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] rounded px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none text-center shadow-lg font-mono">
                        <span className="font-bold text-emerald-400">{val} Applications</span>
                        <div className="text-slate-400 text-[9px]">Class Share: {Math.round((val / totalApps) * 100)}%</div>
                      </div>

                      <div className="w-16 h-full flex items-end justify-center relative">
                        <motion.div 
                          initial={{ height: 0 }}
                          animate={{ height: `${heightPercent}%` }}
                          transition={{ duration: 0.8, delay: i * 0.08 }}
                          className={`w-8 ${colors[i % colors.length]} rounded-t-md cursor-pointer`}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-slate-500 mt-2 truncate max-w-[80px]">{cat}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
          
          <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-slate-50 text-xs text-slate-400">
            {activeChartTab === 'volume' ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-slate-200"></span> Total Registered Applications
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-indigo-900"></span> Risk-Approved Allocations
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-sky-500"></span> Personal</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-indigo-900"></span> Home</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500"></span> Business</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-500"></span> Education</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-purple-600"></span> Vehicle</span>
              </div>
            )}
          </div>
        </div>

        {/* Risk Distribution Doughnut Card */}
        <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">AI Risk Classification</h3>
            <p className="text-slate-400 text-xs">Real-time risk segment analytics</p>
          </div>

          <div className="my-6 flex justify-center relative">
            {/* SVG custom styled pie donut */}
            <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 36 36">
              {/* Background circle */}
              <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="3" />
              
              {/* Slices calculated from MOCK_APPLICATIONS ratio */}
              {(() => {
                const total = riskSlices.Low + riskSlices.Medium + riskSlices.High;
                const lowPct = (riskSlices.Low / total) * 100;
                const medPct = (riskSlices.Medium / total) * 100;
                const highPct = (riskSlices.High / total) * 100;

                // Stroke dasharray pattern: "percent, remaining"
                const lowDash = `${lowPct} ${100 - lowPct}`;
                const medDash = `${medPct} ${100 - medPct}`;
                const highDash = `${highPct} ${100 - highPct}`;

                const medOffset = 100 - lowPct;
                const highOffset = 100 - lowPct - medPct;

                return (
                  <>
                    {/* Low Risk Segment (Green) */}
                    <circle 
                      cx="18" cy="18" r="15.915" 
                      fill="none" 
                      stroke="#00A86B" 
                      strokeWidth="3.5" 
                      strokeDasharray={lowDash} 
                      strokeDashoffset="0"
                    />
                    {/* Medium Risk Segment (Orange) */}
                    <circle 
                      cx="18" cy="18" r="15.915" 
                      fill="none" 
                      stroke="#f59e0b" 
                      strokeWidth="3.5" 
                      strokeDasharray={medDash} 
                      strokeDashoffset={medOffset}
                    />
                    {/* High Risk Segment (Red) */}
                    <circle 
                      cx="18" cy="18" r="15.915" 
                      fill="none" 
                      stroke="#ef4444" 
                      strokeWidth="3.5" 
                      strokeDasharray={highDash} 
                      strokeDashoffset={highOffset}
                    />
                  </>
                );
              })()}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-black text-indigo-950 font-mono">{totalApps}</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Total Audits</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs text-slate-600 bg-slate-50/50 px-3 py-2 rounded-xl border border-slate-100">
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Low Risk (&lt;35)</span>
              <span className="font-mono font-bold text-slate-800">{riskSlices.Low} <span className="text-slate-400 font-normal">({Math.round((riskSlices.Low / totalApps) * 100)}%)</span></span>
            </div>
            <div className="flex justify-between items-center text-xs text-slate-600 bg-slate-50/50 px-3 py-2 rounded-xl border border-slate-100">
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Medium Risk (35-70)</span>
              <span className="font-mono font-bold text-slate-800">{riskSlices.Medium} <span className="text-slate-400 font-normal">({Math.round((riskSlices.Medium / totalApps) * 100)}%)</span></span>
            </div>
            <div className="flex justify-between items-center text-xs text-slate-600 bg-slate-50/50 px-3 py-2 rounded-xl border border-slate-100">
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> High Risk (&gt;70)</span>
              <span className="font-mono font-bold text-slate-800 text-red-600">{riskSlices.High} <span className="text-slate-400 font-normal">({Math.round((riskSlices.High / totalApps) * 100)}%)</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Applications Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/40">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Recent Applications Incoming Queue</h3>
            <p className="text-xs text-slate-500">OCR-extracted values & live algorithmic pre-screens</p>
          </div>
          <button 
            onClick={() => onNavigate('applications')}
            className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1"
          >
            Manage Queue <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                <th className="px-6 py-3.5">ID</th>
                <th className="px-6 py-3.5">Customer Profile</th>
                <th className="px-6 py-3.5">Loan Type</th>
                <th className="px-6 py-3.5">Requested Amount</th>
                <th className="px-6 py-3.5">OCR Status</th>
                <th className="px-6 py-3.5 text-center">AI Risk Index</th>
                <th className="px-6 py-3.5 text-center">State</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recentApplications.map((app) => {
                // Determine badge colors
                let statusBadge = '';
                if (app.status === 'Approved') statusBadge = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                else if (app.status === 'Pending') statusBadge = 'bg-amber-50 text-amber-700 border-amber-100';
                else statusBadge = 'bg-rose-50 text-rose-700 border-rose-100';

                let riskColor = 'text-emerald-600 bg-emerald-50';
                if (app.riskScore > 70) riskColor = 'text-red-600 bg-red-50';
                else if (app.riskScore > 35) riskColor = 'text-amber-600 bg-amber-50';

                let ocrBadge = 'bg-blue-50 text-blue-700 border-blue-100';
                if (app.ocrStatus === 'Pending') ocrBadge = 'bg-slate-50 text-slate-600 border-slate-200';
                else if (app.ocrStatus === 'Error') ocrBadge = 'bg-rose-50 text-rose-600 border-rose-100';

                return (
                  <tr key={app.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-4 font-mono text-xs font-semibold text-indigo-950">{app.id}</td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">{app.customerName}</div>
                      <div className="text-[11px] text-slate-400">Monthly Income: ${app.income.toLocaleString()}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-medium text-xs">
                        {app.loanType}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-slate-800">
                      ${app.amount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ocrBadge}`}>
                        <Shield className="w-2.5 h-2.5" />
                        {app.ocrStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex flex-col items-center">
                        <span className={`text-xs font-mono font-extrabold px-2 py-0.5 rounded-md ${riskColor}`}>
                          {app.riskScore}%
                        </span>
                        <div className="w-12 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                          <div 
                            className={`h-full ${app.riskScore > 70 ? 'bg-red-500' : app.riskScore > 35 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                            style={{ width: `${app.riskScore}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${statusBadge}`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => onViewApplication(app)}
                        className="p-1.5 hover:bg-indigo-50 hover:text-indigo-900 text-slate-400 rounded-lg transition-colors inline-flex items-center justify-center"
                        title="Analyze Application Profile"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
