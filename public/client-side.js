document.addEventListener('DOMContentLoaded', () => {
    // Check both localStorage and cookies for userToken
    const userToken = getStoredToken();
    
    // If no token and we're on index.html, redirect to login
    if (!userToken && window.location.pathname === '/index.html') {
        window.location.href = '/login.html';
        return;
    }
    
    if (userToken) {
        // If token exists, attempt immediate validation
        validateToken();
    } else {
        showLoginForm();
    }
});

// Initialize the game page after successful validation
function initializeGamePage(username) {
    // Update UI with username
    document.getElementById('usernameDisplay').textContent = username;
    
    // Connect WebSocket
    connectWebSocket();
    
    // Initialize lobby
    initializeLobby();
}

// WebSocket connection
function connectWebSocket() {
    const ws = new WebSocket('ws://' + window.location.host);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        // Send login message with token
        ws.send(JSON.stringify({ type: 'login', token: localStorage.getItem('userToken') }));
        
        // Request online users
        ws.send(JSON.stringify({ type: 'getOnlineUsers' }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'onlineUsers':
                updateOnlineUsers(data.users);
                break;
            case 'error':
                showError(data.message);
                break;
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showError('Connection error. Please try again.');
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        // TODO: Handle reconnection logic
    };
}

// Initialize lobby UI
function initializeLobby() {
    // Add event listener for refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        // Request online users
        const ws = new WebSocket('ws://' + window.location.host);
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'getOnlineUsers' }));
        };
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'onlineUsers') {
                updateOnlineUsers(data.users);
                ws.close();
            }
        };
    });

    // Add event listener for logout button
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    
    // Add event listener for user list items
    const userList = document.getElementById('userList');
    userList.addEventListener('click', (event) => {
        if (event.target.tagName === 'LI' && !event.target.classList.contains('playing')) {
            const username = event.target.textContent;
            sendGameInvite(username);
        }
    });
}

// Handle logout
function handleLogout() {
    localStorage.removeItem('userToken');
    document.cookie = 'userToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    localStorage.removeItem('username');
    window.location.href = '/login.html';
}

// Update online users list
function updateOnlineUsers(users) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user.username;
        if (user.isPlaying) {
            li.classList.add('playing');
        }
        userList.appendChild(li);
    });
}

// Send game invite
function sendGameInvite(username) {
    const ws = new WebSocket('ws://' + window.location.host);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'invite',
            inviteeToken: localStorage.getItem('userToken'),
            inviteeUsername: username
        }));
        ws.close();
    };
}

// Helper function to get token from either storage
function getStoredToken() {
    // Check localStorage first
    const localStorageToken = localStorage.getItem('userToken');
    if (localStorageToken) return localStorageToken;

    // Check cookies if localStorage is empty
    const cookieToken = getCookie('userToken');
    if (cookieToken) {
        // If token is found in cookie but not in localStorage, update localStorage
        localStorage.setItem('userToken', cookieToken);
        return cookieToken;
    }

    return null;
}

// Helper function to get cookie value
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

async function validateToken() {
    try {
        // Get the token from either storage
        const userToken = getStoredToken();
        if (!userToken) {
            throw new Error('No token found');
        }

        // Send token for validation
        const response = await fetch('/api/validateToken', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: userToken })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Validation failed');
        }

        // Verify we received all required data
        if (!data.userToken || !data.username || !data.success) {
            throw new Error('Invalid response from server');
        }

        // Update both storage locations with fresh token
        localStorage.setItem('userToken', data.userToken);
        document.cookie = `userToken=${data.userToken}; path=/; max-age=31536000`;
        localStorage.setItem('username', data.username);

        // Only redirect if we're not already on index.html
        if (window.location.pathname !== '/index.html') {
            window.location.href = '/index.html';
        } else {
            // Initialize the game page
            initializeGamePage(data.username);
        }

    } catch (error) {
        console.error('Error validating token:', error);
        // Clear both storage locations on error
        localStorage.removeItem('userToken');
        document.cookie = 'userToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        localStorage.removeItem('username');
        showLoginForm();
    }
}

function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
}

async function handleLogin() {
    const nickname = document.getElementById('nickname').value.trim();
    
    if (!nickname) {
        showError('Please enter a nickname');
        return;
    }

    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('loading').style.display = 'block';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username: nickname })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        // Verify we received all required data
        if (!data.userToken || !data.username || !data.success) {
            throw new Error('Invalid response from server');
        }

        // Store token in both localStorage and cookie
        localStorage.setItem('userToken', data.userToken);
        localStorage.setItem('username', data.username);
        document.cookie = `userToken=${data.userToken}; path=/; max-age=31536000`;

        // Redirect to index.html
        window.location.href = '/index.html';

    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'An error occurred. Please try again.');
    } finally {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('loading').style.display = 'none';
    }
}

function showError(message) {
    document.getElementById('error').textContent = message;
    document.getElementById('error').style.display = 'block';
    document.getElementById('success').style.display = 'none';
}

function showSuccess(message) {
    document.getElementById('success').textContent = message;
    document.getElementById('success').style.display = 'block';
    document.getElementById('error').style.display = 'none';
}
