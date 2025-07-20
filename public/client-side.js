document.addEventListener('DOMContentLoaded', () => {
    // Check both localStorage and cookies for userToken
    const userToken = getStoredToken();
    if (userToken) {
        // If token exists, attempt immediate validation
        validateToken();
    } else {
        showLoginForm();
    }
});

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
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username: localStorage.getItem('username') })
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

        // Redirect to index.html
        window.location.href = '/index.html';

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
