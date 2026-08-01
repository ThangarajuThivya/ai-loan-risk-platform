// Admin Mock Datasets for Aura AI Loan System

// Generate 50 unique customers
export const MOCK_CUSTOMERS = Array.from({ length: 50 }).map((_, index) => {
  const firstNames = [
    'Alexander', 'Sophia', 'Liam', 'Olivia', 'Noah', 'Emma', 'Jackson', 'Ava', 'Aiden', 'Isabella',
    'Lucas', 'Mia', 'Oliver', 'Amelia', 'Ethan', 'Harper', 'David', 'Evelyn', 'John', 'Charlotte',
    'James', 'Abigail', 'Robert', 'Emily', 'Michael', 'Elizabeth', 'William', 'Sofia', 'Daniel', 'Avery',
    'Benjamin', 'Ella', 'Matthew', 'Madison', 'Henry', 'Scarlett', 'Joseph', 'Victoria', 'Samuel', 'Aria',
    'Daniel', 'Grace', 'Owen', 'Chloe', 'Sebastian', 'Camila', 'Jack', 'Penelope', 'Wyatt', 'Layla'
  ];

  const lastNames = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson',
    'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Hernandez', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White',
    'Lopez', 'Lee', 'Gonzalez', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Perez', 'Hall',
    'Young', 'Allen', 'Sanchez', 'Wright', 'King', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson',
    'Carter', 'Mitchell', 'Perez', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards'
  ];

  const firstName = firstNames[index % firstNames.length];
  const lastName = lastNames[index % lastNames.length];
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;

  const creditScoreRange = [520, 580, 610, 640, 670, 710, 740, 780, 810, 850];
  const creditScore = creditScoreRange[index % creditScoreRange.length] + (index % 15);

  const employmentTypes = ['Salaried', 'Self-Employed', 'Business Owner', 'Contractor'];

  const incomeMin = 3000;
  const incomeMax = 18000;
  const income = Math.floor(incomeMin + ((index * 313) % (incomeMax - incomeMin)));

  return {
    id: `CUST-${1000 + index}`,
    name: `${firstName} ${lastName}`,
    email,
    phone: `+1 (555) 01${(index * 7) % 9}${(index * 3) % 9}-${(index * 11) % 9000 + 1000}`,
    status: index % 12 === 0 ? 'inactive' : 'active',
    joinedDate: `2026-02-${(index % 25) + 1 < 10 ? '0' + ((index % 25) + 1) : (index % 25) + 1}`,
    avatarLetter: firstName[0] + lastName[0],
    income,
    creditScore,
    employmentType: employmentTypes[index % employmentTypes.length],
    totalLoans: (index % 3) + 1
  };
});


// Generate 100 Loan Applications
export const MOCK_APPLICATIONS = Array.from({ length: 100 }).map((_, index) => {
  const customer = MOCK_CUSTOMERS[index % MOCK_CUSTOMERS.length];

  const loanTypes = ['Personal', 'Home', 'Business', 'Education', 'Vehicle'];
  const loanType = loanTypes[index % loanTypes.length];

  const loanAmountMultiplier = {
    Personal: 12000,
    Home: 320000,
    Business: 85000,
    Education: 24000,
    Vehicle: 35000
  };

  const amount = Math.floor(
    loanAmountMultiplier[loanType] +
    ((index * 1317) % (loanAmountMultiplier[loanType] * 0.4))
  );

  let riskScore = 85 - (customer.creditScore - 500) * 0.15;
  if (customer.employmentType === 'Unemployed') riskScore += 20;
  if (customer.income < 4000) riskScore += 10;

  riskScore = Math.max(5, Math.min(98, Math.round(riskScore + (index % 11) - 5)));

  let status = 'Pending';

  if (riskScore < 35 && index % 3 !== 0) {
    status = 'Approved';
  } else if (riskScore > 75 && index % 2 === 0) {
    status = 'Rejected';
  }

  const ocrStatuses = ['Verified', 'Verified', 'Verified', 'Pending', 'Error'];
  const ocrStatus = ocrStatuses[index % ocrStatuses.length];

  const docs = [
    'Form_1040_Tax.pdf',
    'W2_Income_Stmt.png',
    'Commercial_Ledger.xls',
    'Tuition_Invoice.pdf',
    'Registration_Doc.pdf'
  ];

  const verificationDoc = docs[index % docs.length];

  return {
    id: `APPL-${2000 + index}`,
    customerId: customer.id,
    customerName: customer.name,
    loanType,
    amount,
    income: customer.income,
    riskScore,
    status,
    appliedDate: `2026-05-${(index % 28) + 1 < 10 ? '0' + ((index % 28) + 1) : (index % 28) + 1}`,
    ocrStatus,
    verificationDoc
  };
});


// Generate Contact Messages
export const MOCK_MESSAGES = Array.from({ length: 15 }).map((_, index) => {
  const senders = [
    { name: 'David Miller', email: 'miller.d@gmail.com', subject: 'API Access Credentials Query' },
    { name: 'Sarah Jenkins', email: 's.jenkins@outlook.com', subject: 'OCR Extraction Failure on JPEG' },
    { name: 'Robert Chen', email: 'robert.chen@techfinance.io', subject: 'Partnership Interest - Bank Integration' },
    { name: 'Lisa Kudrow', email: 'lisa.k@finance.org', subject: 'Moratorium Grace Period Extension' },
    { name: 'Frank Underhill', email: 'frank@house.gov', subject: 'Compliance Audits & SOC2 Verification' }
  ];

  const messages = [
    'Hello, we are hoping to integrate the Aura API inside our internal credit ledger. What are the pricing tiers and onboarding times for developers?',
    'I tried to upload a high-contrast scan of my tax certificate, but the OCR returned an indexing error. Can I send my documents to an officer for manual check?',
    'Our commercial firm is looking to outsource our automated mortgage risk pre-approvals. We would love to book a live demo session with Dr. Carter.',
    'Is there an option in the personal portfolio to request customized grace periods of more than six months? Our graduates require extended flexibility.',
    'We require the official SOC2 Type II audit reports to proceed with our institutional evaluation. Please direct me to your compliance officer.'
  ];

  const statuses = ['unread', 'read', 'replied'];

  const sender = senders[index % senders.length];

  return {
    id: `MSG-${3000 + index}`,
    name: sender.name,
    email: sender.email,
    subject: sender.subject,
    message: messages[index % messages.length],
    status: statuses[index % statuses.length],
    date: `2026-06-${20 - index < 10 ? '0' + (20 - index) : 20 - index}`
  };
});