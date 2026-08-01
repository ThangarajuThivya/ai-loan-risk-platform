import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  User,
  Mail,
  Lock,
  Phone,
  ShieldCheck,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Database,
  Briefcase,
  Calendar,
  AlertCircle,
  Eye,
  EyeOff,
  MapPin,
  Users,
  Camera,
  Trash2,
} from "lucide-react";
import api from "../api/axios";
import { useToast } from "../components/toast/useToast";

export default function Register() {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const { showToast } = useToast();

  // Form States - Step 1: Account Info
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role] = useState("customer"); // Default value: customer. User cannot change.

  // Profile Image states
  const [profileImage, setProfileImage] = useState(null);
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [imageError, setImageError] = useState(null);
  const [showImageSuccess, setShowImageSuccess] = useState(false);
  const fileInputRef = useRef(null);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    const validTypes = ["image/jpeg", "image/jpg", "image/png"];
    if (!validTypes.includes(file.type)) {
      setImageError(
        t('register.errImageFormat'),
      );
      setProfileImage(null);
      setProfileImageFile(null);
      setShowImageSuccess(false);
      return;
    }

    // Validate size (2MB = 2 * 1024 * 1024 bytes)
    if (file.size > 2 * 1024 * 1024) {
      setImageError(t('register.errImageSize'));
      setProfileImage(null);
      setProfileImageFile(null);
      setShowImageSuccess(false);
      return;
    }

    setImageError(null);
    setProfileImageFile(file);

    // Read file for preview
    const reader = new FileReader();
    reader.onload = () => {
      setProfileImage(reader.result);
      setShowImageSuccess(true);
      // Automatically fade check icon after some time
      setTimeout(() => {
        setShowImageSuccess(false);
      }, 3000);
    };
    reader.readAsDataURL(file);
  };

  const removeProfileImage = (e) => {
    e.stopPropagation(); // prevent triggering file click
    setProfileImage(null);
    setProfileImageFile(null);
    setImageError(null);
    setShowImageSuccess(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Password Visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form States - Step 2: Customer Profile Info
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [address, setAddress] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [monthlyExpense, setMonthlyExpense] = useState("");

  // Validation States
  const [touchedStep1, setTouchedStep1] = useState(false);
  const [touchedStep2, setTouchedStep2] = useState(false);
  const [errors, setErrors] = useState({});

  // Step 1 success notification overlay flag
  const [showStep1Success, setShowStep1Success] = useState(false);

  // Live validator for Step 1
  const validateStep1 = (currentValues = {}) => {
    const fN =
      currentValues?.fName !== undefined ? currentValues.fName : firstName;
    const lN =
      currentValues?.lName !== undefined ? currentValues.lName : lastName;
    const em = currentValues?.mail !== undefined ? currentValues.mail : email;
    const ph = currentValues?.ph !== undefined ? currentValues.ph : phone;
    const pw =
      currentValues?.pass !== undefined ? currentValues.pass : password;
    const cp =
      currentValues?.cPass !== undefined
        ? currentValues.cPass
        : confirmPassword;

    const newErrors = {};

    if (!fN.trim()) {
      newErrors.firstName = t('register.errFirstNameRequired');
    }
    if (!lN.trim()) {
      newErrors.lastName = t('register.errLastNameRequired');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!em.trim()) {
      newErrors.email = t('register.errEmailRequired');
    } else if (!emailRegex.test(em)) {
      newErrors.email = t('register.errEmailInvalid');
    }

    const phoneRegex = /^\+?[\d\s\-()]{10,18}$/;
    if (!ph.trim()) {
      newErrors.phone = t('register.errPhoneRequired');
    } else if (!phoneRegex.test(ph)) {
      newErrors.phone =
        t('register.errPhoneInvalid');
    }

    if (!pw) {
      newErrors.password = t('register.errPasswordRequired');
    } else if (pw.length < 8) {
      newErrors.password = t('register.errPasswordTooShort');
    }

    if (!cp) {
      newErrors.confirmPassword = t('register.errConfirmPasswordRequired');
    } else if (cp !== pw) {
      newErrors.confirmPassword = t('register.errPasswordsMismatch');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Live validator for Step 2
  const validateStep2 = (currentValues = {}) => {
    const dobValue =
      currentValues?.dob !== undefined ? currentValues.dob : dateOfBirth;
    const genValue =
      currentValues?.gen !== undefined ? currentValues.gen : gender;
    const addrValue =
      currentValues?.addr !== undefined ? currentValues.addr : address;
    const empValue =
      currentValues?.emp !== undefined ? currentValues.emp : employmentType;
    const compValue =
      currentValues?.comp !== undefined ? currentValues.comp : companyName;
    const incValue =
      currentValues?.inc !== undefined ? currentValues.inc : monthlyIncome;
    const expValue =
      currentValues?.exp !== undefined ? currentValues.exp : monthlyExpense;

    const newErrors = {};

    if (!dobValue) {
      newErrors.dateOfBirth = t('register.errDobRequired');
    } else {
      // Basic age check (must be at least 18 years old for lending sandbox rules)
      const birthDate = new Date(dobValue);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age < 18) {
        newErrors.dateOfBirth = t('register.errDobUnderage');
      }
    }

    if (!genValue) {
      newErrors.gender = t('register.errGenderRequired');
    }

    if (!addrValue.trim()) {
      newErrors.address = t('register.errAddressRequired');
    }

    if (!empValue) {
      newErrors.employmentType = t('register.errEmploymentRequired');
    }

    // Company is required if not student/unemployed
    if (
      (empValue === "Salaried Employee" ||
        empValue === "Business Owner" ||
        empValue === "Self Employed") &&
      !compValue.trim()
    ) {
      newErrors.companyName = t('register.errCompanyRequired');
    }

    if (incValue === "") {
      newErrors.monthlyIncome = t('register.errIncomeRequired');
    } else if (Number(incValue) < 0) {
      newErrors.monthlyIncome = t('register.errIncomeNegative');
    }

    if (expValue === "") {
      newErrors.monthlyExpense = t('register.errExpenseRequired');
    } else if (Number(expValue) < 0) {
      newErrors.monthlyExpense = t('register.errExpenseNegative');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Step 1 Form Handler
  const handleStep1Submit = (e) => {
    e.preventDefault();
    setTouchedStep1(true);
    const isValid = validateStep1();
    if (isValid && !imageError) {
      // Show transitional automatic redirection notice
      setShowStep1Success(true);
      setTimeout(() => {
        setShowStep1Success(false);
        setStep(2);
      }, 1600);
    }
  };

  // Step 2 Form Handler
  const handleStep2Submit = (e) => {
    e.preventDefault();
    setTouchedStep2(true);
    const isValid = validateStep2();
    if (isValid) {
      setStep(3);
    }
  };

  // Final Registration Submission Handler
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();

    setLoading(true);

    try {
      const formData = new FormData();

      formData.append("firstName", firstName);

      formData.append("lastName", lastName);

      formData.append("email", email);

      formData.append("phone", phone);

      formData.append("password", password);

      formData.append("dateOfBirth", dateOfBirth);

      formData.append("gender", gender);

      formData.append("address", address);

      formData.append("employmentType", employmentType);

      formData.append("companyName", companyName);

      formData.append("monthlyIncome", monthlyIncome);

      formData.append("monthlyExpense", monthlyExpense);

      // Image

      formData.append("profileImage", profileImageFile);

      await api.post(
        "/auth/register",

        formData,

        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );
      showToast({
        type: "success",

        title: t('register.registrationSuccessTitle'),

        message: t('register.registrationSuccessMessage', { name: `${firstName} ${lastName}` }),
      });


      setRegistered(true);
    } catch (error) {
      showToast({
        type: "error",

        title: t('register.registrationFailedTitle'),

        message: error.response?.data?.message || t('register.invalidInputs'),
      });
    } finally {
      setLoading(false);
    }
  };

  // Dynamic Border feedback (Bootstrap-like status style with Tailwind)
  const getValidationClass = (fieldName, isTouched) => {
    if (!isTouched) return "border-slate-200 focus:border-brand-primary";
    return errors[fieldName]
      ? "border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10"
      : "border-emerald-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10";
  };

  return (
    <div className="pt-24 pb-16 bg-brand-bg min-h-screen flex flex-col justify-center items-center px-4">
      {/* Page Title Header */}
      <div className="text-center mb-8 space-y-1">
        <div className="inline-flex items-center space-x-2 bg-brand-primary p-3.5 rounded-2xl shadow-md text-white mb-4">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>
        <h1 className="font-display font-bold text-2xl text-slate-900 leading-none">
          {t('register.pageTitle')}
        </h1>
        <p className="text-slate-500 text-xs">
          Complete your secure profile for automated AI risk scoring & instant
          liquidity.
        </p>
      </div>

      {/* Main Registration Card Wizard */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl max-w-lg w-full p-6 sm:p-10 relative overflow-hidden">
        {/* Step Indicator Header (Hide if fully registered) */}
        {!registered && (
          <div className="mb-8 border-b border-slate-100 pb-5">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] font-mono font-black tracking-widest text-[#0F4C81] uppercase">
                {t('register.journeyLabel')}
              </span>
              <span className="text-[10px] font-mono font-black text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded">
                {t('register.stepOf', { step })}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {/* Step 1 */}
              <div className="space-y-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${step >= 1 ? "bg-brand-primary" : "bg-slate-100"}`}
                />
                <span
                  className={`text-[10px] font-bold block truncate text-center ${step === 1 ? "text-brand-primary font-extrabold" : "text-slate-400"}`}
                >
                  {t('register.step1Short')}
                </span>
              </div>
              {/* Step 2 */}
              <div className="space-y-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${step >= 2 ? "bg-brand-primary" : "bg-slate-100"}`}
                />
                <span
                  className={`text-[10px] font-bold block truncate text-center ${step === 2 ? "text-brand-primary font-extrabold" : "text-slate-400"}`}
                >
                  {t('register.step2Short')}
                </span>
              </div>
              {/* Step 3 */}
              <div className="space-y-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${step >= 3 ? "bg-brand-primary" : "bg-slate-100"}`}
                />
                <span
                  className={`text-[10px] font-bold block truncate text-center ${step === 3 ? "text-brand-primary font-extrabold" : "text-slate-400"}`}
                >
                  {t('register.step3Short')}
                </span>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* Step 1 success notification full card overlay */}
          {showStep1Success && (
            <motion.div
              key="step-1-success-overlay"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-0 bg-white/95 backdrop-blur-xs z-20 flex flex-col items-center justify-center p-6 text-center"
            >
              <div className="w-16 h-16 bg-emerald-50 rounded-full border border-emerald-100 flex items-center justify-center text-emerald-600 mb-4 animate-bounce">
                <CheckCircle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 leading-snug">
                Account created successfully!
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mt-2">
                Moving automatically to Step 2 to complete your profile
                information.
              </p>
              <div className="mt-5 flex items-center gap-1.5 text-[10px] font-mono text-emerald-600 font-bold bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                <Database className="w-3.5 h-3.5 animate-pulse" /> Inserting
                Users Record...
              </div>
            </motion.div>
          )}

          {!registered ? (
            step === 1 ? (
              /* ================== STEP 1: ACCOUNT INFORMATION ================== */
              <motion.form
                key="step-1-form"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                onSubmit={handleStep1Submit}
                className="space-y-4"
              >
                <div className="mb-2">
                  <h3 className="font-display font-bold text-lg text-slate-900">
                    {t('register.step1Title')}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Create your administrative credentials on Aura Secure
                    Directory.
                  </p>
                </div>

                {/* Profile Image Section */}
                <div className="flex flex-col items-center justify-center py-4 border-b border-dashed border-slate-100 mb-2">
                  <div
                    className="relative group cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {/* Avatar Container with Hover Zoom Effect */}
                    <div className="w-[120px] h-[120px] rounded-full bg-white border-2 border-[#0F4C81] shadow-md flex items-center justify-center overflow-hidden transition-all duration-300 hover:scale-105 relative">
                      {profileImage ? (
                        <motion.img
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.3 }}
                          src={profileImage}
                          alt={t('register.profilePreviewAlt')}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-slate-400">
                          <User className="w-16 h-16 text-slate-300" />
                        </div>
                      )}

                      {/* Success check animation overlay */}
                      <AnimatePresence>
                        {showImageSuccess && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-[#0F4C81]/90 backdrop-blur-xs flex flex-col items-center justify-center text-white z-10"
                          >
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{
                                type: "spring",
                                stiffness: 300,
                                damping: 20,
                              }}
                            >
                              <CheckCircle className="w-10 h-10 text-emerald-400" />
                            </motion.div>
                            <span className="text-[10px] font-bold mt-1 uppercase tracking-wider text-emerald-300 font-mono">
                              {t('register.uploaded')}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Upload icon overlay at bottom-right corner */}
                    <div className="absolute bottom-1 right-1 bg-[#0F4C81] hover:bg-[#0c3e6a] p-2 rounded-full text-white shadow-md border-2 border-white transition-all duration-200 hover:scale-110">
                      <Camera className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Hidden File Input */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageChange}
                    accept=".jpg,.jpeg,.png"
                    className="hidden"
                  />

                  {/* Text / Actions */}
                  <div className="mt-3 text-center">
                    {profileImage ? (
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs font-bold text-[#0F4C81] hover:underline cursor-pointer"
                        >
                          {t('register.changeImage')}
                        </button>
                        <span className="text-slate-300 text-xs">|</span>
                        <button
                          type="button"
                          onClick={removeProfileImage}
                          className="text-xs font-bold text-rose-500 hover:underline flex items-center space-x-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t('register.removeImage')}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs font-bold text-[#0F4C81] hover:underline cursor-pointer transition-opacity duration-200"
                      >
                        {t('register.uploadImage')}
                      </button>
                    )}
                  </div>

                  {/* Error Message for Upload validation */}
                  {imageError && (
                    <div className="text-rose-600 text-[11px] mt-2 font-medium flex items-center gap-1.5 bg-rose-50 border border-rose-100 px-3 py-1.5 rounded-xl">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 animate-bounce" />
                      <span>{imageError}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* First Name */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.firstNameLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto" />
                      <input
                        type="text"
                        required
                        placeholder="John"
                        value={firstName}
                        onChange={(e) => {
                          setFirstName(e.target.value);
                          if (touchedStep1)
                            validateStep1({ fName: e.target.value });
                        }}
                        className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("firstName", touchedStep1)}`}
                      />
                    </div>
                    {touchedStep1 && errors.firstName && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.firstName}</span>
                      </div>
                    )}
                  </div>

                  {/* Last Name */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.lastNameLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto" />
                      <input
                        type="text"
                        required
                        placeholder="Doe"
                        value={lastName}
                        onChange={(e) => {
                          setLastName(e.target.value);
                          if (touchedStep1)
                            validateStep1({ lName: e.target.value });
                        }}
                        className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("lastName", touchedStep1)}`}
                      />
                    </div>
                    {touchedStep1 && errors.lastName && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.lastName}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Email Address */}
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                    {t('register.emailLabel')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto" />
                    <input
                      type="email"
                      required
                      placeholder="john.doe@gmail.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (touchedStep1)
                          validateStep1({ mail: e.target.value });
                      }}
                      className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("email", touchedStep1)}`}
                    />
                  </div>
                  {touchedStep1 && errors.email && (
                    <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{errors.email}</span>
                    </div>
                  )}
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                    {t('register.phoneLabel')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto" />
                    <input
                      type="tel"
                      required
                      placeholder="+1 (555) 019-2834"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (touchedStep1) validateStep1({ ph: e.target.value });
                      }}
                      className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("phone", touchedStep1)}`}
                    />
                  </div>
                  {touchedStep1 && errors.phone && (
                    <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{errors.phone}</span>
                    </div>
                  )}
                </div>

                {/* Password Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Password */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.passwordLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder={t('register.passwordPlaceholder')}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (touchedStep1)
                            validateStep1({ pass: e.target.value });
                        }}
                        className={`w-full pl-10 pr-10 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("password", touchedStep1)}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-3.5 flex items-center text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {touchedStep1 && errors.password && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.password}</span>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.confirmPasswordLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto" />
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        placeholder={t('register.confirmPasswordPlaceholder')}
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (touchedStep1)
                            validateStep1({ cPass: e.target.value });
                        }}
                        className={`w-full pl-10 pr-10 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("confirmPassword", touchedStep1)}`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowConfirmPassword(!showConfirmPassword)
                        }
                        className="absolute inset-y-0 right-3.5 flex items-center text-slate-400 hover:text-slate-600"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {touchedStep1 && errors.confirmPassword && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.confirmPassword}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Role Disclaimer Panel */}
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-start gap-2.5 text-[11px] text-slate-500 leading-normal">
                  <Users className="w-4.5 h-4.5 text-brand-primary shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-700 block">
                      Default Role Assignment: customer
                    </span>
                    Sovereign banking registration standard assigns the{" "}
                    <span className="font-semibold text-brand-primary">
                      customer
                    </span>{" "}
                    role automatically. Staff and directors utilize distinct
                    physical auth keychains.
                  </div>
                </div>

                {/* Continue button */}
                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full bg-[#0F4C81] hover:bg-[#0c3e6a] text-white py-3.5 rounded-xl font-bold transition-all duration-200 flex items-center justify-center space-x-2 shadow-md hover:shadow-lg text-sm cursor-pointer"
                  >
                    <span>{t('register.saveAndProceed')}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.form>
            ) : step === 2 ? (
              /* ================== STEP 2: CUSTOMER PROFILE INFORMATION ================== */
              <motion.form
                key="step-2-form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                onSubmit={handleStep2Submit}
                className="space-y-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-display font-bold text-lg text-slate-900">
                      {t('register.step2Title')}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Provide demographic metrics required for real-time risk
                      scoring.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(1);
                      setTouchedStep2(false);
                    }}
                    className="text-xs font-bold text-slate-500 hover:text-brand-primary flex items-center space-x-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{t('register.backButton')}</span>
                  </button>
                </div>

                {/* Step 1 success notification banner remains at top of step 2 form */}
                <div className="p-3 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Account created successfully. Complete your profile
                    information below.
                  </span>
                </div>

                {/* DOB & Gender */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* DOB */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.dobLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Calendar className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto pointer-events-none" />
                      <input
                        type="date"
                        required
                        value={dateOfBirth}
                        onChange={(e) => {
                          setDateOfBirth(e.target.value);
                          if (touchedStep2)
                            validateStep2({ dob: e.target.value });
                        }}
                        className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("dateOfBirth", touchedStep2)}`}
                      />
                    </div>
                    {touchedStep2 && errors.dateOfBirth && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.dateOfBirth}</span>
                      </div>
                    )}
                  </div>

                  {/* Gender */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.genderLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => {
                        setGender(e.target.value);
                        if (touchedStep2)
                          validateStep2({ gen: e.target.value });
                      }}
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 bg-white transition-all ${getValidationClass("gender", touchedStep2)}`}
                    >
                      <option value="">{t('register.selectGender')}</option>
                      <option value="Male">{t('register.genderMale')}</option>
                      <option value="Female">{t('register.genderFemale')}</option>
                      <option value="Other">{t('register.genderOther')}</option>
                    </select>
                    {touchedStep2 && errors.gender && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.gender}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Residential Address */}
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                    {t('register.addressLabel')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <MapPin className="absolute top-3 left-3.5 w-4 h-4 text-slate-400" />
                    <textarea
                      rows={2}
                      required
                      placeholder={t('register.addressPlaceholder')}
                      value={address}
                      onChange={(e) => {
                        setAddress(e.target.value);
                        if (touchedStep2)
                          validateStep2({ addr: e.target.value });
                      }}
                      className={`w-full pl-10 pr-4 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("address", touchedStep2)}`}
                    />
                  </div>
                  {touchedStep2 && errors.address && (
                    <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{errors.address}</span>
                    </div>
                  )}
                </div>

                {/* Employment Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.employmentTypeLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={employmentType}
                      onChange={(e) => {
                        setEmploymentType(e.target.value);
                        if (touchedStep2)
                          validateStep2({ emp: e.target.value });
                      }}
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 bg-white transition-all ${getValidationClass("employmentType", touchedStep2)}`}
                    >
                      <option value="">{t('register.selectEmployment')}</option>
                      <option value="Salaried Employee">
                        {t('register.employmentSalaried')}
                      </option>
                      <option value="Self Employed">{t('register.employmentSelfEmployed')}</option>
                      <option value="Business Owner">{t('register.employmentBusinessOwner')}</option>
                      <option value="Student">{t('register.employmentStudent')}</option>
                      <option value="Unemployed">{t('register.employmentUnemployed')}</option>
                    </select>
                    {touchedStep2 && errors.employmentType && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.employmentType}</span>
                      </div>
                    )}
                  </div>

                  {/* Company Name */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.companyNameLabel')}{" "}
                      {(employmentType === "Salaried Employee" ||
                        employmentType === "Business Owner" ||
                        employmentType === "Self Employed") && (
                        <span className="text-rose-500">*</span>
                      )}
                    </label>
                    <div className="relative">
                      <Briefcase className="absolute inset-y-0 left-3.5 w-4 h-4 text-slate-400 my-auto" />
                      <input
                        type="text"
                        placeholder={t('register.companyPlaceholder')}
                        value={companyName}
                        onChange={(e) => {
                          setCompanyName(e.target.value);
                          if (touchedStep2)
                            validateStep2({ comp: e.target.value });
                        }}
                        className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 transition-all ${getValidationClass("companyName", touchedStep2)}`}
                      />
                    </div>
                    {touchedStep2 && errors.companyName && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.companyName}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Monthly Income & Monthly Expense */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Monthly Income */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.monthlyIncomeLabel')}{" "}
                      <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3.5 flex items-center text-slate-400 text-sm font-semibold pointer-events-none">
                        $
                      </span>
                      <input
                        type="number"
                        required
                        placeholder="e.g. 5000"
                        value={monthlyIncome}
                        onChange={(e) => {
                          setMonthlyIncome(e.target.value);
                          if (touchedStep2)
                            validateStep2({ inc: e.target.value });
                        }}
                        className={`w-full pl-8 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 font-mono transition-all ${getValidationClass("monthlyIncome", touchedStep2)}`}
                      />
                    </div>
                    {touchedStep2 && errors.monthlyIncome && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.monthlyIncome}</span>
                      </div>
                    )}
                  </div>

                  {/* Monthly Expense */}
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('register.monthlyExpenseLabel')}{" "}
                      <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3.5 flex items-center text-slate-400 text-sm font-semibold pointer-events-none">
                        $
                      </span>
                      <input
                        type="number"
                        required
                        placeholder="e.g. 1500"
                        value={monthlyExpense}
                        onChange={(e) => {
                          setMonthlyExpense(e.target.value);
                          if (touchedStep2)
                            validateStep2({ exp: e.target.value });
                        }}
                        className={`w-full pl-8 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/10 font-mono transition-all ${getValidationClass("monthlyExpense", touchedStep2)}`}
                      />
                    </div>
                    {touchedStep2 && errors.monthlyExpense && (
                      <div className="text-rose-600 text-[11px] mt-1.5 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{errors.monthlyExpense}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Continue button */}
                <div className="pt-4">
                  <button
                    type="submit"
                    className="w-full bg-[#0F4C81] hover:bg-[#0c3e6a] text-white py-3.5 rounded-xl font-bold transition-all duration-200 flex items-center justify-center space-x-2 shadow-md hover:shadow-lg text-sm cursor-pointer"
                  >
                    <span>{t('register.verifyDetails')}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.form>
            ) : (
              /* ================== STEP 3: CONFIRMATION PAGE ================== */
              <motion.form
                key="step-3-form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                onSubmit={handleRegisterSubmit}
                className="space-y-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-display font-bold text-lg text-slate-900">
                      {t('register.step3Title')}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Confirm details before publishing to secure ledgers.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="text-xs font-bold text-slate-500 hover:text-brand-primary flex items-center space-x-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{t('register.backButton')}</span>
                  </button>
                </div>

                {/* Segment: Account Details */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4.5 space-y-3">
                  <span className="text-[10px] font-mono font-black tracking-widest text-brand-primary uppercase block border-b border-dashed border-slate-200 pb-1.5">
                    {t('register.accountDetailsHeading')}
                  </span>

                  {/* Profile Avatar Confirmation Preview */}
                  <div className="flex items-center space-x-3.5 border-b border-dashed border-slate-200/80 pb-3">
                    {profileImage ? (
                      <div className="w-12 h-12 rounded-full overflow-hidden border border-brand-primary/30 shadow-xs">
                        <img
                          src={profileImage}
                          alt="Avatar"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-slate-400 border border-slate-300/40">
                        <User className="w-6 h-6" />
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase font-mono tracking-wider font-semibold">
                        Sovereign Avatar
                      </span>
                      <span className="text-xs font-semibold text-slate-700">
                        {profileImageFile
                          ? profileImageFile.name
                          : t('register.noImageUploaded')}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2.5 text-xs text-slate-700">
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.nameLabel')}
                      </span>
                      <span className="font-bold text-slate-800">
                        {firstName} {lastName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.roleAssignmentLabel')}
                      </span>
                      <span className="font-bold text-brand-primary bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded text-[10px] uppercase font-mono">
                        {role}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block font-medium">
                        {t('register.emailLabelColon')}
                      </span>
                      <span className="font-bold text-slate-800 break-all">
                        {email}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block font-medium">
                        {t('register.phoneLabelColon')}
                      </span>
                      <span className="font-bold text-slate-800 font-mono">
                        {phone}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Segment: Profile Details */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4.5 space-y-3">
                  <span className="text-[10px] font-mono font-black tracking-widest text-brand-primary uppercase block border-b border-dashed border-slate-200 pb-1.5">
                    {t('register.profileDetailsHeading')}
                  </span>

                  <div className="grid grid-cols-2 gap-y-2.5 text-xs text-slate-700">
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.dobLabelColon')}
                      </span>
                      <span className="font-bold text-slate-800 font-mono">
                        {dateOfBirth}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.genderLabelColon')}
                      </span>
                      <span className="font-bold text-slate-800">{gender}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block font-medium">
                        {t('register.addressLabelColon')}
                      </span>
                      <span className="font-bold text-slate-800 leading-normal">
                        {address}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.employmentStatusLabelColon')}
                      </span>
                      <span className="font-bold text-slate-800">
                        {employmentType}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.companyNameLabelColon')}
                      </span>
                      <span className="font-bold text-slate-800">
                        {companyName || t('register.notApplicable')}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.monthlyIncomeLabelColon')}
                      </span>
                      <span className="font-black text-emerald-600 font-mono text-sm">
                        ${Number(monthlyIncome).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">
                        {t('register.monthlyExpenseLabelColon')}
                      </span>
                      <span className="font-black text-rose-600 font-mono text-sm">
                        ${Number(monthlyExpense).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Underwriting Trust Seal */}
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                  <ShieldCheck className="w-4 h-4 text-brand-primary shrink-0" />
                  <span>
                    Verified cryptographic ledger write prepared. Proceeding
                    triggers risk evaluation.
                  </span>
                </div>

                {/* Submit button */}
                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#00A86B] hover:bg-[#008c59] text-white py-3.5 rounded-xl font-bold transition-all duration-200 flex items-center justify-center space-x-2 shadow-md hover:shadow-lg text-sm cursor-pointer uppercase tracking-wider glow-btn"
                  >
                    {loading ? (
                      <>
                        <svg
                          className="animate-spin h-5 w-5 text-white mr-2"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        <span>{t('register.creatingProfile')}</span>
                      </>
                    ) : (
                      <span>{t('register.createAccount')}</span>
                    )}
                  </button>
                </div>
              </motion.form>
            )
          ) : (
            /* ================== REGISTER SUCCESS OVERLAY ================== */
            <motion.div
              key="register-success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center p-6 space-y-5"
            >
              <div className="bg-emerald-50 text-emerald-600 p-4 rounded-full inline-block mx-auto border border-emerald-100 animate-bounce">
                <CheckCircle className="w-12 h-12 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-display font-bold text-xl text-slate-900">
                  {t('register.congratulations', { firstName })}
                </h3>
                <p className="text-slate-600 text-xs leading-relaxed max-w-sm mx-auto mt-1">
                  Your secure sovereign customer account and loan profile have
                  been initialized successfully on Aura Secure Vault.
                </p>
              </div>

             
           

              <div className="pt-4 space-y-2.5">
                <a
                  href="/login"
                  className="bg-[#0F4C81] hover:bg-[#0c3e6a] text-white py-3.5 rounded-xl text-xs font-bold hover:scale-[1.01] transition-all duration-200 w-full block text-center shadow-md cursor-pointer"
                >
                  {t('register.wantToLogin')}
                </a>
              
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
