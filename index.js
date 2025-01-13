require("dotenv").config();
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const csv = require("csv-parser");

// File paths
const selfUserJsonPath = path.join(__dirname, "self_user.json");
const outputJsonPath = path.join(__dirname, "aggregatedSharedUsers.json");
const coursesListPath = path.join(__dirname, "courses_list.csv");

// Ensure files exist
function ensureFilesExist() {
  // Create `courses_list.csv` if it doesn't exist
  if (!fs.existsSync(coursesListPath)) {
    fs.writeFileSync(
      coursesListPath,
      "course_id,course_name,section_id,section_name\n",
      "utf8"
    );
    console.log(`${coursesListPath} created with default header.`);
  }

  // Create `self_user.json` if it doesn't exist
  if (!fs.existsSync(selfUserJsonPath)) {
    fs.writeFileSync(selfUserJsonPath, "[]", "utf8"); // Default empty JSON array
    console.log(`${selfUserJsonPath} created with default empty array.`);
  }

  // Create `aggregatedSharedUsers.json` if it doesn't exist
  if (!fs.existsSync(outputJsonPath)) {
    fs.writeFileSync(outputJsonPath, "[]", "utf8"); // Default empty JSON array
    console.log(`${outputJsonPath} created with default empty array.`);
  }
}

// Call the function to ensure files exist
ensureFilesExist();

const csvFilePath = path.join(__dirname, "./users/users_listaggregated.csv");

const API_URL = "https://ucmerced.instructure.com/api/v1/";
const API_KEY = process.env.CANVAS_API_KEY;

const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
  },
});

//updated code to get courses
async function getAllCourses(pageUrl = null, allCourses = []) {
  let url = pageUrl || `courses?per_page=100&state[]=available`;

  try {
    const response = await axiosInstance.get(url);

    // Collect course data
    response.data.forEach((course) => {
      allCourses.push({
        id: course.id,
        name: course.name,
        courseCode: course.course_code,
        startAt: course.start_at ? new Date(course.start_at) : null,
        endAt: course.end_at ? new Date(course.end_at) : null,
      });
    });

    // Handle pagination
    const linkHeader = response.headers["link"];
    if (linkHeader) {
      const links = linkHeader.split(",");
      let nextUrl = null;
      links.forEach((link) => {
        if (link.includes('rel="next"')) {
          nextUrl = link.substring(link.indexOf("<") + 1, link.indexOf(">"));
        }
      });

      if (nextUrl) {
        await getAllCourses(nextUrl, allCourses);
      }
    }

    // After fetching all courses
    if (!pageUrl) {
      console.log("All courses fetched:", allCourses.length);

      // Filter courses for the closest semester
      const currentSemesterCourses = filterClosestSemester(allCourses);
      // console.log(
      //   "Filtered courses for the closest semester:",
      //   currentSemesterCourses.length
      // );

      writeCoursesToCSV(currentSemesterCourses);
      return currentSemesterCourses;
    }
  } catch (error) {
    console.error("Error fetching courses:", error);
  }
}

// Function to filter courses for the closest semester
function filterClosestSemester(courses) {
  const today = new Date();

  // Find the course with the start date closest to today
  const closestCourse = courses.reduce((closest, course) => {
    if (!course.startAt || !course.endAt) return closest; // Skip invalid courses

    const currentDiff = Math.abs(today - course.startAt);
    const closestDiff = Math.abs(today - closest.startAt);

    return currentDiff < closestDiff ? course : closest;
  }, courses[0]);

  // Filter all courses that belong to the same semester as the closest course
  return courses.filter((course) => {
    if (!course.startAt || !course.endAt) return false;
    return (
      Math.abs(course.startAt - closestCourse.startAt) <=
        5 * 24 * 60 * 60 * 1000 && // Start time within ±5 days
      Math.abs(course.endAt - closestCourse.endAt) <= 5 * 24 * 60 * 60 * 1000 // End time within ±5 days
    );
  });
}

function writeCoursesToCSV(courses) {
  // const filePath = path.join(__dirname, "courses_list.csv");
  const filePath = coursesListPath;

  // Prepare CSV headers and rows
  const headers = "course_id,course_name,course_code,start_at,end_at\n";
  const rows = courses
    .map(
      (course) =>
        `${course.id},${course.name},${course.courseCode},${course.startAt},${course.endAt}`
    )
    .join("\n");

  // Write the CSV file
  fs.writeFile(filePath, headers + rows, (err) => {
    if (err) {
      console.error("Error writing to file:", err);
    } else {
      // console.log(`Courses list saved to ${filePath}`);
    }
  });
}

async function getAllUsers(courseId, index) {
  let allUsers = [];
  await fetchUsersRecursively(courseId, null, allUsers);
  // console.log("All users fetched:", allUsers.length);
  await writeUsersToCSV(allUsers, index);
  return allUsers;
}

async function fetchUsersRecursively(courseId, pageUrl = null, allUsers = []) {
  let url =
    pageUrl ||
    `courses/${courseId}/users?per_page=100&include[]=email&include[]=enrollments&include[]=avatar_url`;

  try {
    const response = await axiosInstance.get(url);

    // Process and collect user data
    response.data.forEach((user) => {
      const courseSectionIds = user.enrollments
        .map(
          (enrollment) => `${enrollment.course_section_id}-${enrollment.type}`
        )
        .join(";");
      allUsers.push({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatar_url,
        courseSectionIds,
      });
    });

    const linkHeader = response.headers["link"];
    if (linkHeader) {
      const links = linkHeader.split(",");
      let nextUrl = null;
      links.forEach((link) => {
        if (link.includes('rel="next"')) {
          nextUrl = link.substring(link.indexOf("<") + 1, link.indexOf(">"));
        }
      });

      if (nextUrl) {
        await fetchUsersRecursively(courseId, nextUrl, allUsers);
      }
    }
  } catch (error) {
    console.error("Error fetching users:", error.message || error);
  }
}

async function writeUsersToCSV(users, index) {
  const filePath = path.join(__dirname, `./users/users_list${index}.csv`);

  // Prepare CSV headers and rows
  const headers = "user_id,user_name,avatar_url,course_section_ids\n";
  const rows = users
    .map(
      (user) =>
        `${user.id},${user.name},${user.avatarUrl},"${user.courseSectionIds}"`
    )
    .join("\n");

  // Write the CSV file
  fs.writeFile(filePath, headers + rows, (err) => {
    if (err) {
      console.error("Error writing to file:", err);
    } else {
      console.log(`Users list saved to ${filePath}`);
    }
  });
}

async function getSelfUserId() {
  try {
    const response = await axiosInstance.get("/users/self");
    const selfUserId = response.data.id;
    // console.log("Self User ID:", selfUserId);
    return selfUserId;
  } catch (error) {
    console.error("Error fetching self user ID:", error.message || error);
    throw new Error("Failed to fetch self user ID");
  }
}

async function extractUser(users, userId) {
  // Filter the users array to find all instances where the user ID matches the specified userId
  let foundInstances = users.filter((user) => user.id === userId);

  if (foundInstances.length > 0) {
    // console.log("User found:", foundInstances);
    return foundInstances; // Return an array of user objects
  } else {
    // console.log("No user found with the ID:", userId);
    return []; // Return an empty array if no user is found
  }
}

// Function to save data to a JSON file
async function saveToJsonFile(data, fileName) {
  return new Promise((resolve, reject) => {
    const outputFilePath = `./${fileName}.json`;
    fs.writeFile(outputFilePath, JSON.stringify(data, null, 2), (err) => {
      if (err) {
        console.error(`Error writing to JSON file: ${err.message || err}`);
        reject(err);
      } else {
        // console.log(`Data successfully saved to ${outputFilePath}`);
        resolve();
      }
    });
  });
}

async function processAndAggregateSharedUsers() {
  try {
    // Read the enriched self_user.json file
    const self_user = JSON.parse(fs.readFileSync(selfUserJsonPath, "utf8"));

    // Array to hold CSV data
    const csvData = [];

    // Read the CSV file
    return new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on("data", (row) => {
          csvData.push(row);
        })
        .on("end", async () => {
          const aggregatedSharedUsers = [];

          // Process shared users
          for (const selfUser of self_user) {
            // Extract section IDs from the enriched structure
            const selfUserCourses = selfUser.courseSectionIds.map(
              (section) => section.sectionId
            );

            for (const user of csvData) {
              // Extract section IDs from CSV user data
              const userCourses = user.course_section_ids
                .split(";")
                .map((id) => id.split("-")[0]);

              // Find shared courses
              const sharedCourses = userCourses.filter((course) =>
                selfUserCourses.includes(course)
              );

              // Enrich shared courses with section details
              const enrichedSharedCourses = [];
              for (const sectionId of sharedCourses) {
                const sectionDetails = selfUser.courseSectionIds.find(
                  (section) => section.sectionId === sectionId
                );
                if (sectionDetails) {
                  enrichedSharedCourses.push(sectionDetails);
                }
              }

              // Check if the user is already in the aggregatedSharedUsers array
              const existingUser = aggregatedSharedUsers.find(
                (aggUser) => aggUser.user_id === user.user_id
              );

              if (existingUser) {
                // Update existing entry: append new enriched shared courses
                existingUser.shared_courses = [
                  ...existingUser.shared_courses,
                  ...enrichedSharedCourses,
                ];
                existingUser.shared_count += enrichedSharedCourses.length;
              } else {
                // Add a new entry for this user
                aggregatedSharedUsers.push({
                  user_id: user.user_id,
                  user_name: user.user_name,
                  avatar_url: user.avatar_url,
                  shared_courses: enrichedSharedCourses,
                  shared_count: enrichedSharedCourses.length,
                });
              }
            }
          }

          // Write the aggregated shared users to a JSON file
          fs.writeFileSync(
            outputJsonPath,
            JSON.stringify(aggregatedSharedUsers, null, 2),
            "utf8"
          );

          console.log("Aggregated shared users saved to:", outputJsonPath);
          resolve();
        })
        .on("error", (err) => {
          console.error("Error reading CSV file:", err);
          reject(err);
        });
    });
  } catch (err) {
    console.error("Error processing and aggregating shared users:", err);
  }
}

async function enrichCourseSectionIds(users) {
  const enrichedUsers = [];

  for (const user of users) {
    const sectionIds = user.courseSectionIds
      .split(";")
      .map((id) => id.split("-")[0]); // Extract section IDs
    const enrichedSections = [];

    for (const sectionId of sectionIds) {
      const details = await getCourseDetailsBySectionId(sectionId);
      if (details) {
        enrichedSections.push({
          sectionId: details.sectionId,
          courseCode: details.courseCode,
          sectionName: details.sectionName,
        });
      } else {
        console.warn(`No details found for section ID: ${sectionId}`);
      }
    }

    // Push the enriched user object
    enrichedUsers.push({
      ...user,
      courseSectionIds: enrichedSections, // Replace with enriched sections
    });
  }

  return enrichedUsers;
}

async function getCourseDetailsBySectionId(sectionId) {
  try {
    // Fetch section details using the section ID
    const sectionResponse = await axiosInstance.get(`sections/${sectionId}`);
    const section = sectionResponse.data;

    // Fetch course details using the course ID from the section
    const courseId = section.course_id;
    const courseResponse = await axiosInstance.get(`courses/${courseId}`);
    const course = courseResponse.data;

    return {
      sectionId,
      courseId: course.id,
      courseName: course.name,
      courseCode: course.course_code,
      sectionName: section.name,
    };
  } catch (error) {
    console.error(
      `Error fetching details for section ID ${sectionId}:`,
      error.message
    );
    return null; // Return null or handle the error appropriately
  }
}

(async () => {
  const courses = await getAllCourses();
  let aggregatedUsers = []; // Initialize an empty array to hold all users from all courses

  for (let index = 0; index < courses.length; index++) {
    const course = courses[index];
    console.log("course name:", course.name, "course code:", course.courseCode);
    try {
      const allUsers = await getAllUsers(course.id, index);
      aggregatedUsers = aggregatedUsers.concat(allUsers); // Add users from the current course to the aggregated array
    } catch (error) {
      console.error(
        `Continuing despite failure to fetch users for course ${course.id}:`,
        error.message || error
      );
      continue; // Continue with the next course if there's an error
    }
  }

  // console.log("Total users aggregated:", aggregatedUsers.length);
  // console.log("Aggregated users:", aggregatedUsers);

  // You can also write the aggregated users to a CSV file if needed
  await writeUsersToCSV(aggregatedUsers, "aggregated");

  const selfUserId = await getSelfUserId();
  const extractedUserInstances = await extractUser(aggregatedUsers, selfUserId);

  console.log("Enriching course section IDs...");
  const enrichedUsers = await enrichCourseSectionIds(extractedUserInstances);

  await saveToJsonFile(enrichedUsers, "self_user");

  // Process shared users
  await processAndAggregateSharedUsers();

  // let sectionId = <your_section_id>; // Replace with the actual section ID
  // const details = await getCourseDetailsBySectionId(sectionId);
  // console.log("Course details:", details);
})();
