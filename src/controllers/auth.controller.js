import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import sendMail from "../services/sendMail.js";

//WIP : Manage the refresh token to generate new access or refresh token also


// For generate the token
const generateAccessAndRefereshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generating referesh and access token"
    );
  }
};

// Registing the user
const register = asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body;

  // Check filed are exist or not
  if (!email || !password || !username || !role) {
    throw new ApiError(400, "All filed are requried");
  }

  // Check username exist or not
  const existingVerifiedUserByUsername = await User.findOne({
    username,
    isVerified: true,
  });

  // if exist the send error
  if (existingVerifiedUserByUsername) {
    throw new ApiError(400, "Username already taken");
  }

  // Check email exist or not
  const existingUserByEmail = await User.findOne({ email });
  const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

  // if exist or not exist
  if (existingUserByEmail) {
    // exist or verified
    if (existingUserByEmail.isVerified) {
      throw new ApiError(400, "User already exists with this email");
      return;
    } else {
      // email exist but not verified
      existingUserByEmail.password = password;
      existingUserByEmail.verifyCode = verifyCode;
      existingUserByEmail.verifyCodeExpiry = new Date(Date.now() + 3600000);
      await existingUserByEmail.save({ validateBeforeSave: false });
    }
  } else {
    // email not exist create new user
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 1);

    const newUser = new User({
      username,
      email,
      password,
      role,
      verifyCode,
      verifyCodeExpiry: expiryDate,
      isVerified: false,
    });

    await newUser.save();
  }

  // Sending the mail
  const data = { user: { name: username }, activationCode: verifyCode };
  await sendMail({
    email,
    subject: "Activate your account",
    template: "activation-mail.ejs",
    data,
  });
  const user = await User.findOne({ email });
  const userId = user._id;
  const token = jwt.sign({ userId }, process.env.ACTIVATION_TOKEN_SECRET, {
    expiresIn: "1h",
  });

  return res
    .status(200)
    .cookie("activation_token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 60 * 60 * 1000,
    })
    .json(new ApiResponse(200, {}, "Verification code send Successfully"));
});


// Activate the user here
export const activateUser = asyncHandler(async (req, res) => {
  const { activation_code } = req.body;

  // Ensure activation code is provided
  if (!activation_code) {
    throw new ApiError(400, "Please provide the activation code");
  }

  // Get token from either cookies or authorization header
  const token =
    req.cookies?.activation_token ||
    req.header("Authorization")?.replace("Bearer ", "");

  console.log(activation_code, token);
  // Ensure token is provided
  if (!token) {
    throw new ApiError(400, "Please provide the activation token");
  }

  // Verify the JWT token and extract the user ID
  let decodedToken;
  try {
    decodedToken = jwt.verify(token, process.env.ACTIVATION_TOKEN_SECRET);
  } catch (error) {
    throw new ApiError(400, "Invalid or expired token");
  }

  // Find user by extracted userId from token
  const user = await User.findById(decodedToken.userId);

  // Ensure user exists
  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  // Check if the provided activation code matches the one in the database
  if (user.verifyCode !== activation_code) {
    throw new ApiError(400, "Invalid activation code");
  }

  // Check if the activation code is expired
  if (user.verifyCodeExpiry && user.verifyCodeExpiry < Date.now()) {
    throw new ApiError(400, "Activation code has expired");
  }

  // Mark user as verified and clear verification-related fields
  await User.findByIdAndUpdate(
    decodedToken.userId,
    {
      isVerified: true,
      verifyCode: "",
      verifyCodeExpiry: null,
    },
    { new: true } // Returns the updated user
  );

  // Send success response
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "User verified successfully"));
});

// Login the user here
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email && !password) {
    throw new ApiError(400, "Email or password is required");
  }

  const user = await User.findOne({ email });

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  if (!user.isVerified) {
    throw new ApiError(404, "Verify the user first");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
    user._id
  );

  const loggedInUser = await User.findById(user._id);

  // Set cookie options with expiration times
  const accessTokenOptions = {
    httpOnly: true,
    secure: true, // Set to `true` in production for HTTPS
    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days in milliseconds
  };

  const refreshTokenOptions = {
    httpOnly: true,
    secure: true, // Set to `true` in production for HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  };

  const data = {
    _id: loggedInUser._id,
    username: loggedInUser.username,
    email: loggedInUser.email,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, accessTokenOptions)
    .cookie("refreshToken", refreshToken, refreshTokenOptions)
    .json(new ApiResponse(200, data, "User logged in successfully"));
});

// Logout the user
const logout = asyncHandler(async (req, res) => {
  const options = {
    httpOnly: false,
    secure: false,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged Out"));
});

// Social Auth for user
const socialAuth = asyncHandler(async (req, res) => {
  const { email, name } = req.body;
  const user = await userModel.findOne({ email });

  const options = {
    httpOnly: false,
    secure: false,
  };

  if (!user) {
    const newUser = await userModel.create({ email, name });
    const { refreshToken, accessToken } = generateAccessAndRefereshTokens(
      newUser._id
    );
    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options)
      .json(new ApiResponse(200, loggedInUser, "User logged In Successfully"));
  } else {
    const { refreshToken, accessToken } = generateAccessAndRefereshTokens(
      user._id
    );
    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options)
      .json(new ApiResponse(200, loggedInUser, "User logged In Successfully"));
  }
});


// Forgot password
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    throw new ApiError(400, "User not exist");
  }

  const resetToken = crypto.randomBytes(20).toString("hex");
  const resetTokenExpiresAt = Date.now() + 1 * 60 * 60 * 1000;

  user.resetPasswordToken = resetToken;
  user.resetPasswordExpiresAt = resetTokenExpiresAt;

  await user.save();

  //send mail
  const resetLink = `${process.env.RESET_URL}/${user.resetPasswordToken}`;
  const data = { user: { name: user.username, forgotToken: resetLink } };
  await sendMail({
    email: user.email,
    subject: "Forgot Password",
    template: "forgotPassword-mail.ejs",
    data,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password reset link sent to your email"));
});

//Reset password
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpiresAt: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError(400, "Reset link does not match");
  }

  if (!password) {
    throw new ApiError(400, "");
  }
  // update password
  user.password = password;
  user.resetPasswordExpiresAt = undefined;
  user.resetPasswordToken = undefined;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password reset successfully"));
});

export { register, login, logout, socialAuth,forgotPassword,resetPassword };


