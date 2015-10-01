import Octokat from 'octokat';
import React from 'react';
import FixedDataTable from 'fixed-data-table';
import OAuth from 'oauth-js';
import {CacheHandler} from './cache-handler';

var GitHubIssueRank = (function () {

  var out = {};

  var hasVote = out.hasVote = function (str) {

    var lines = str.split('\n');

    var found = false;

    lines.forEach(function (line) {
      if (found) return;
      var isBlockQuote = line.match(/^\s*>/);
      if (isBlockQuote) return;
      found = found || line.match(/(^|[\W\b])(\+1|:\+1:|:thumbsup:|\uD83D\uDC4D)([\W\b]|$)/g);
      // TODO: Ignore +1's within quotation marks?
    });

    return found;
  };



  var octo;
  var githubAccessToken;




  var withComments = function (comments) {
    getVoteCountForComment(comments);
  };


  var getVoteCountForComment = function (comments) {
    // console.log(comments);

    var voteCount = 0;

    var alreadyUsers = {};

    comments.forEach(function (comment) {
      var body = comment.body;

      var login = comment.user.login;

      // console.log('comment', comment);

      if (alreadyUsers[login]) {
        return;
      }

      var thisHasVote = hasVote(body);
      if (thisHasVote) {
        // console.log('has vote', thisHasVote, body);
        // if (comment.issueUrl.match(/\/2$/)) {
        //   console.log('comment', login, comment.body);
        // }

        alreadyUsers[login] = true;

        voteCount += 1;
      }
    });

    return voteCount;
  };


  var postAuth = function (options) {

    getIssuesThenComments(
      options.owner,
      options.repo,
      function (err, issue, comments) {
        // console.log('eachIssueComment', issue, comments);
      },
      function (err, results) {
        // results = _.sortBy(results, function (r) { return r.issue.number; });

        results.forEach(function (result) {
          var voteCount = 0;
          if (result.comments) {
            voteCount = getVoteCountForComment(result.comments);
          }
          result.voteCount = voteCount;
        });

        results = _.sortBy(results, function (result) {
          return -1 * result.voteCount;
        });

        var components = [];

        var Table = FixedDataTable.Table;
        var Column = FixedDataTable.Column;

        // Table data as a list of array.
        var rows = [];

        results.forEach(function (result) {
          var issue = result.issue;
          var voteCount = result.voteCount;

          var ratio = voteCount / issue.comments;

          rows.push([
            issue.number,
            issue.title,
            issue.htmlUrl,
            voteCount,
            issue.comments,
            ratio
          ]);
        });

        var rowGetter = function (rowIndex) {
          return rows[rowIndex];
        };

        var titleRenderer = function (cellData, cellDataKey, rowData, rowIndex, columnData, width) {
          return (
            <a target="_blank"
              href={rowData[2]}
            >
              {rowData[1]}
            </a>
          );
        };
        var issueNumberRenderer = function (cellData, cellDataKey, rowData, rowIndex, columnData, width) {
          return (
            <a target="_blank"
              href={rowData[2]}
            >
              {rowData[0]}
            </a>
          );
        };
        var ratioRenderer = function (cellData, cellDataKey, rowData, rowIndex, columnData, width) {
          var ratio = rowData[5];
          var perc = ratio * 100;
          var pretty = perc.toFixed(1) + '%';
          return pretty;
        };

        components.push(
          <Table
            rowHeight={50}
            rowGetter={rowGetter}
            rowsCount={rows.length}
            width={700}
            height={400}
            headerHeight={50}>
            <Column
              label="Issue #"
              width={100}
              dataKey={0}
              cellRenderer={issueNumberRenderer}
            />
            <Column
              label="Title"
              width={200}
              dataKey={1}
              cellRenderer={titleRenderer}
            />
            <Column
              label="# Votes"
              width={100}
              dataKey={3}
            />
            <Column
              label="# Comments"
              width={100}
              dataKey={4}
            />
            <Column
              label="Ratio"
              width={100}
              dataKey={5}
              cellRenderer={ratioRenderer}
            />
          </Table>
        );

        React.render(
          <div>{components}</div>
          ,
          document.getElementById('wrap')
        );
      }
    );
  };


  out.run = function (options) {

    options = options || {};

    OAuth.initialize(options.oAuthIoKey);

    OAuth.popup('github')
      .done(function(result) {
          console.log(arguments);
          githubAccessToken = result.access_token;

          console.log('githubAccessToken', githubAccessToken);

          var cacheHandler = new CacheHandler();

          octo = new Octokat({
            // username: "USER_NAME",
            // password: "PASSWORD"
            //
            token: githubAccessToken,
            cacheHandler: cacheHandler
          });

          postAuth(options);
      })
      .fail(function (err) {
          console.error(arguments);
      });
  };


  function getIssuesThenComments(owner, repo, eachIssueComments, done) {
    done = done || function () {};
    getIssues(
      owner, repo,
      function (err, issues) {
        console.log(err, issues);
        
        async.map(issues,
          function (issue, cb) {
            if (issue.comments) {   
              getComments(
                owner, repo, issue.number,
                function (err, comments) {
                  // console.log(err, comments);
                  eachIssueComments(err, issue, comments);
                  cb(err, {
                    issue: issue,
                    comments: comments
                  });
                }
              );
            }
            else {
              eachIssueComments(null, issue, null);
              cb(null, {
                issue: issue
              });
            }
          },
          function (err, results) {
            if (err) return done(err);
            done(err, results);
          }
        );
      }
    );
  };


  function fetchAllPages(cacheKey, onOcto, done) {

    var promiser = function () { return onOcto(octo); };
    var allData = [];

    async.doWhilst(
      function (cb) {
        promiser().then(
          function (data) {
            allData = allData.concat(data);
            promiser = data.nextPage;
            cb();
          },
          function (err) {
            cb(err);
          }
        );
      },
      function () {
        return promiser;
      },
      function (err) {
        if (err) throw err;

        done(err, allData);
      }
    );
  };


  function getComments(owner, repo, issue, done) {

    var cacheKey = 'comments:' + owner + '/' + repo + '/' + issue;

    var onOcto = function (octo) {
      return octo
        .repos(owner, repo)
        .issues(issue)
        .comments
        .fetch();
    };

    fetchAllPages(cacheKey, onOcto, done);
  };


  function getIssues(owner, repo, done) {

    var cacheKey = 'issues:' + owner + '/' + repo;

    var onOcto = function (octo) {
      return octo
        .repos(owner, repo)
        .issues
        .fetch();
    };

    fetchAllPages(cacheKey, onOcto, done);
  };

  return out;

})();

export {GitHubIssueRank};
