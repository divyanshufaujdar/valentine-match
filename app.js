const input = document.getElementById('idInput');
const btn = document.getElementById('lookupBtn');
const result = document.getElementById('result');
const errorBox = document.getElementById('error');

const yourName = document.getElementById('yourName');
const yourId = document.getElementById('yourId');
const matchName = document.getElementById('matchName');
const matchId = document.getElementById('matchId');
const messageBox = document.getElementById('messageBox');
const messageText = document.getElementById('messageText');
const submitPaymentBtn = document.getElementById('submitPaymentBtn');
const paymentStatus = document.getElementById('paymentStatus');
const payerNameInput = document.getElementById('payerNameInput');
const waitingNote = document.getElementById('waitingNote');

const valentineBox = document.getElementById('valentineBox');
const valentineMessage = document.getElementById('valentineMessage');
const sweetBtn = document.getElementById('sweetBtn');
const jokeBtn = document.getElementById('jokeBtn');
const sharePrompt = document.getElementById('sharePrompt');
let pollTimer = null;
const startScreen = document.getElementById('startScreen');
const enterBtn = document.getElementById('enterBtn');
const mainContent = document.getElementById('mainContent');

const sweetIdeas = [
  'Give this person a treat and a tiny handwritten note.',
  'Some flowers and a sweet compliment go a long way.',
  'Send a cute voice note and wish them a warm Valentine.',
  'Share a small chocolate and say, "You made my day."',
  'Plan a short walk and bring a single rose.',
];

const happyJokes = [
  'What did the stamp say to the envelope? I\'m stuck on you.',
  'Why did the heart go to school? To get a little bolder.',
  'What do you call two birds in love? Tweethearts.',
  'Why did the teddy bear say no to dessert? Because it was stuffed.',
  'What did one flame say to the other? You light up my life.',
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeId(id) {
  return id.replace(/\s+/g, '').toUpperCase();
}

function setPaymentStatus(msg) {
  paymentStatus.textContent = msg || '';
}

function setWaitingNote(show) {
  if (show) {
    waitingNote.classList.remove('hidden');
  } else {
    waitingNote.classList.add('hidden');
  }
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  result.classList.add('hidden');
  valentineBox.classList.add('hidden');
  sharePrompt.classList.add('hidden');
  setPaymentStatus('');
  setWaitingNote(false);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function checkApproval(id) {
  const res = await fetch(`/api/status?id=${encodeURIComponent(id)}`);
  const data = await res.json();
  const credits = data && data.record ? data.record.credits : 0;
  if (data.status === 'approved' && credits > 0) {
    stopPolling();
    setPaymentStatus(`Payment approved. Credits available: ${credits}. Fetching match...`);
    setWaitingNote(false);
    lookup(true);
  }
}

function startPolling(id) {
  stopPolling();
  pollTimer = setInterval(() => {
    checkApproval(id).catch(() => {});
  }, 4000);
}

function showResult(entry) {
  errorBox.classList.add('hidden');
  result.classList.remove('hidden');
  valentineBox.classList.remove('hidden');
  sharePrompt.classList.remove('hidden');

  yourName.textContent = entry.name || '-';
  yourId.textContent = entry.id || '-';

  if (!entry.match_id) {
    matchName.textContent = 'No match assigned';
    matchId.textContent = '-';
  } else {
    matchName.textContent = entry.match_name || '-';
    matchId.textContent = entry.match_id || '-';
  }

  if (!entry.match_id) {
    messageText.textContent = 'you maaah sigma lil bro';
    messageBox.classList.remove('hidden');
  } else if (entry.message) {
    messageText.textContent = entry.message;
    messageBox.classList.remove('hidden');
  } else {
    messageText.textContent = '';
    messageBox.classList.add('hidden');
  }

  valentineMessage.textContent = pick(sweetIdeas);
}

async function submitPayment() {
  const raw = input.value.trim();
  const payerName = payerNameInput.value.trim();
  if (!raw) {
    showError('Please enter your ID before submitting payment.');
    return;
  }
  if (!payerName) {
    showError('Please enter your good name.');
    return;
  }
  const id = normalizeId(raw);

  try {
    const res = await fetch('/api/submit-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: payerName })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Payment submission failed.');
      return;
    }
    errorBox.classList.add('hidden');
    const pendingCount = typeof data.pending_count === 'number' ? data.pending_count : null;
    const credits = typeof data.credits === 'number' ? data.credits : null;
    if (data.status === 'approved' && credits !== null) {
      setPaymentStatus(`Payment approved. Credits available: ${credits}.`);
      setWaitingNote(false);
      lookup(true);
    } else if (pendingCount !== null) {
      setPaymentStatus(`Payment submitted. Pending approvals: ${pendingCount}.`);
      setWaitingNote(true);
      startPolling(id);
    } else {
      setPaymentStatus('Payment submitted. Waiting for approval.');
      setWaitingNote(true);
      startPolling(id);
    }
  } catch (err) {
    showError('Something went wrong submitting your payment.');
  }
}

async function lookup(auto = false) {
  const raw = input.value.trim();
  if (!raw) {
    if (!auto) showError('Please enter an ID.');
    return;
  }

  const id = normalizeId(raw);

  try {
    const res = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok) {
      if (!auto) showError(data.error || 'Lookup failed.');
      return;
    }
    showResult(data.entry);
    if (typeof data.credits_left === 'number') {
      if (data.credits_left > 0) {
        setPaymentStatus(`Lookup complete. Credits left: ${data.credits_left}.`);
      } else {
        setPaymentStatus('Lookup complete. Pay again to check again.');
      }
    } else {
      setPaymentStatus('Lookup complete. Pay again to check again.');
    }
    setWaitingNote(false);
    stopPolling();
  } catch (err) {
    if (!auto) showError('Something went wrong loading the data.');
  }
}

btn.addEventListener('click', lookup);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') lookup();
});

submitPaymentBtn.addEventListener('click', submitPayment);

sweetBtn.addEventListener('click', () => {
  valentineMessage.textContent = pick(sweetIdeas);
});

jokeBtn.addEventListener('click', () => {
  valentineMessage.textContent = pick(happyJokes);
});

enterBtn.addEventListener('click', () => {
  startScreen.style.display = 'none';
  mainContent.style.display = 'block';
});

mainContent.addEventListener('mousemove', (e) => {
  if (Math.random() > 0.12) return;
  const sparkle = document.createElement('div');
  sparkle.className = 'sparkle';
  sparkle.style.left = `${e.clientX}px`;
  sparkle.style.top = `${e.clientY}px`;
  document.body.appendChild(sparkle);
  setTimeout(() => sparkle.remove(), 1200);
});
